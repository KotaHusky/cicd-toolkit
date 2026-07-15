import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  UpdateCommand: vi.fn((input) => input),
}));
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(),
}));

process.env.RESOURCE_PREFIX = 'test';

const { handler } = await import('../lambdas/presignup/handler.js');

type MockEvent = {
  request: { userAttributes: Record<string, string> };
};

function makeEvent(code: string, email = 'user@example.com'): MockEvent {
  return { request: { userAttributes: { 'custom:inviteCode': code, email } } };
}

describe('presignup handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  it('returns the event when code is valid and unclaimed', async () => {
    const event = makeEvent('ABCDEFGH');
    const result = await handler(event as any);
    expect(result).toBe(event);
    expect(mockSend).toHaveBeenCalledOnce();
    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.TableName).toBe('test-invite-codes');
    expect(cmd.Key).toEqual({ pk: 'INVITE_CODE', sk: 'CODE#ABCDEFGH' });
    expect(cmd.ConditionExpression).toContain('attribute_not_exists(usedAt)');
    expect(cmd.ExpressionAttributeValues[':usedBy']).toBe('user@example.com');
  });

  it('rejects an empty code', async () => {
    await expect(handler(makeEvent('') as any)).rejects.toThrow('Invalid invite code');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rejects a code with lowercase letters', async () => {
    await expect(handler(makeEvent('abcdefgh') as any)).rejects.toThrow('Invalid invite code');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rejects a code containing excluded chars (O, 0, I, 1)', async () => {
    await expect(handler(makeEvent('OOOOOOOO') as any)).rejects.toThrow('Invalid invite code');
    await expect(handler(makeEvent('00000000') as any)).rejects.toThrow('Invalid invite code');
    await expect(handler(makeEvent('IIIIIIII') as any)).rejects.toThrow('Invalid invite code');
    await expect(handler(makeEvent('11111111') as any)).rejects.toThrow('Invalid invite code');
  });

  it('rejects a code that is the wrong length', async () => {
    await expect(handler(makeEvent('ABCDEFG') as any)).rejects.toThrow('Invalid invite code');
    await expect(handler(makeEvent('ABCDEFGHI') as any)).rejects.toThrow('Invalid invite code');
  });

  it('rejects an already-used code (ConditionalCheckFailedException)', async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error('condition'), { name: 'ConditionalCheckFailedException' }),
    );
    await expect(handler(makeEvent('ABCDEFGH') as any)).rejects.toThrow('Invalid invite code');
  });

  it('rejects on any DynamoDB error (no oracle)', async () => {
    mockSend.mockRejectedValue(new Error('network error'));
    await expect(handler(makeEvent('ABCDEFGH') as any)).rejects.toThrow('Invalid invite code');
  });
});
