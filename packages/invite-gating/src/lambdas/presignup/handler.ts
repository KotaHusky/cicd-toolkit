import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { PreSignUpTriggerEvent } from 'aws-lambda';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = `${process.env.RESOURCE_PREFIX}-invite-codes`;
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

export async function handler(event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> {
  const code = event.request.userAttributes['custom:inviteCode'] ?? '';

  if (!CODE_RE.test(code)) {
    throw new Error('Invalid invite code');
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { pk: 'INVITE_CODE', sk: `CODE#${code}` },
        UpdateExpression: 'SET usedAt = :usedAt, usedBy = :usedBy',
        ConditionExpression: 'attribute_exists(pk) AND attribute_not_exists(usedAt)',
        ExpressionAttributeValues: {
          ':usedAt': new Date().toISOString(),
          ':usedBy': event.request.userAttributes.email ?? '',
        },
      }),
    );
  } catch {
    throw new Error('Invalid invite code');
  }

  return event;
}
