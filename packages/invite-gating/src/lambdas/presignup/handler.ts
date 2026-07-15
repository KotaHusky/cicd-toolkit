import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { PreSignUpTriggerEvent } from 'aws-lambda';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = `${process.env.RESOURCE_PREFIX}-invite-codes`;
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

export async function handler(event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> {
  // Bypass invite-code enforcement for admin-created users and federated IdP
  // logins. Only direct self-signup (PreSignUp_SignUp) must present a code.
  // PreSignUp_ExternalProvider: social/SAML federation — pool owner controls
  //   who can federate, so no invite gate needed.
  // PreSignUp_AdminCreateUser: admin already has elevated IAM access; gating
  //   would hard-block administrative user creation.
  if (event.triggerSource !== 'PreSignUp_SignUp') {
    return event;
  }

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
        // Enforce expiry atomically at claim time. DynamoDB TTL deletion is
        // best-effort and can lag by up to ~48h, so relying on TTL alone would
        // leave expired codes redeemable until the item is physically deleted.
        ConditionExpression:
          'attribute_exists(pk) AND attribute_not_exists(usedAt) AND expiresAt > :now',
        ExpressionAttributeValues: {
          ':usedAt': new Date().toISOString(),
          ':usedBy': event.request.userAttributes.email ?? '',
          // expiresAt is stored as epoch seconds (Number) by the admin Lambda.
          ':now': Math.floor(Date.now() / 1000),
        },
      }),
    );
  } catch {
    throw new Error('Invalid invite code');
  }

  return event;
}
