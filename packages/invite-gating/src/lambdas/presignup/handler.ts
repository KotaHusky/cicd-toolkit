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

  // Known limitation: Cognito fires PreSignUp BEFORE email confirmation, so a
  // user who begins signup with a valid code but never confirms (or abandons)
  // permanently consumes that code. Unconfirmed users are eventually purged by
  // Cognito, but the code record remains USED with no corresponding active
  // account and no reclaim path (revoke refuses USED codes). If claim-on-
  // confirm semantics are required, move the atomic UpdateCommand to a
  // PostConfirmation trigger and make this handler validation-only
  // (non-mutating attribute_exists check), accepting a small double-claim race.

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
  } catch (err) {
    // Fail closed — user never sees the underlying reason (no code-existence
    // oracle), but operators need the real error to distinguish a bad code from
    // a transient DynamoDB throttle or IAM misconfiguration.
    console.error('Invite code claim failed', err);
    throw new Error('Invalid invite code');
  }

  return event;
}
