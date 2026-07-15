import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomBytes } from 'crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = `${process.env.RESOURCE_PREFIX}-invite-codes`;
const APP_DOMAIN = process.env.APP_DOMAIN ?? '';
const EXPIRY_DAYS = parseInt(process.env.CODE_EXPIRY_DAYS ?? '30', 10);
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type AdminEvent = { action: string; label?: string; labels?: string; code?: string };

function generateCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => CHARSET[b % CHARSET.length]).join('');
}

function parseLabels(event: AdminEvent): string[] {
  if (event.labels?.trim()) {
    return event.labels.split(',').map((l) => l.trim()).filter(Boolean);
  }
  if (event.label?.trim()) {
    return [event.label.trim()];
  }
  return [''];
}

export async function handler(event: AdminEvent) {
  switch (event.action.toLowerCase()) {
    case 'generate': {
      const labels = parseLabels(event);
      const generated: Array<{ code: string; label: string; inviteUrl: string }> = [];
      for (const label of labels) {
        const expiresAt = Math.floor(Date.now() / 1000) + EXPIRY_DAYS * 86400;
        // Guard against the (rare) case where a freshly generated code collides
        // with an existing item. An unconditional Put would silently overwrite an
        // active or already-claimed code. We retry up to 3 times on collision.
        let code = '';
        let attempts = 0;
        while (attempts < 3) {
          code = generateCode();
          attempts++;
          try {
            await ddb.send(
              new PutCommand({
                TableName: TABLE,
                Item: {
                  pk: 'INVITE_CODE',
                  sk: `CODE#${code}`,
                  code,
                  label,
                  createdAt: new Date().toISOString(),
                  expiresAt,
                },
                ConditionExpression: 'attribute_not_exists(sk)',
              }),
            );
            break;
          } catch (err: any) {
            if (err.name === 'ConditionalCheckFailedException' && attempts < 3) {
              continue;
            }
            throw err;
          }
        }
        generated.push({ code, label, inviteUrl: `https://${APP_DOMAIN}/signup?code=${code}` });
      }
      return { generated };
    }

    case 'list': {
      const items: any[] = [];
      let lastKey: Record<string, any> | undefined;
      // Paginate until DynamoDB signals no more results via LastEvaluatedKey.
      do {
        const result = await ddb.send(
          new QueryCommand({
            TableName: TABLE,
            KeyConditionExpression: 'pk = :pk',
            ExpressionAttributeValues: { ':pk': 'INVITE_CODE' },
            ScanIndexForward: false,
            ExclusiveStartKey: lastKey,
          }),
        );
        items.push(...(result.Items ?? []));
        lastKey = result.LastEvaluatedKey;
      } while (lastKey !== undefined);

      const nowSec = Math.floor(Date.now() / 1000);
      const codes = items.map((item) => ({
        code: item.code as string,
        label: (item.label as string) ?? null,
        inviteUrl: `https://${APP_DOMAIN}/signup?code=${item.code}`,
        createdAt: item.createdAt as string,
        expiresAt: new Date((item.expiresAt as number) * 1000).toISOString(),
        usedAt: (item.usedAt as string) ?? null,
        usedBy: (item.usedBy as string) ?? null,
        status: item.usedAt
          ? 'USED'
          : (item.expiresAt as number) < nowSec
            ? 'EXPIRED'
            : 'ACTIVE',
      }));
      return { codes };
    }

    case 'revoke': {
      const code = event.code?.trim();
      if (!code) throw new Error('code is required for revoke action');
      try {
        await ddb.send(
          new DeleteCommand({
            TableName: TABLE,
            Key: { pk: 'INVITE_CODE', sk: `CODE#${code}` },
            ConditionExpression: 'attribute_exists(pk) AND attribute_not_exists(usedAt)',
          }),
        );
        return { revoked: code };
      } catch {
        throw new Error('Code not found or already used — cannot revoke');
      }
    }

    default:
      throw new Error(`Unknown action: "${event.action}". Valid: Generate, List, Revoke`);
  }
}
