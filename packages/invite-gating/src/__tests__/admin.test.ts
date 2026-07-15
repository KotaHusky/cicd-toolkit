import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  PutCommand: vi.fn((input) => input),
  QueryCommand: vi.fn((input) => input),
  DeleteCommand: vi.fn((input) => input),
}));
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(),
}));

process.env.RESOURCE_PREFIX = 'test';
process.env.APP_DOMAIN = 'example.com';
process.env.CODE_EXPIRY_DAYS = '30';

const { handler } = await import('../lambdas/admin/handler.js');

describe('admin handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  // ── generate ──────────────────────────────────────────────────────────

  it('generate: creates one code for a single label', async () => {
    const result = await handler({ action: 'Generate', label: 'For Alex' });
    expect(result.generated).toHaveLength(1);
    expect(result.generated![0].code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(result.generated![0].label).toBe('For Alex');
    expect(result.generated![0].inviteUrl).toBe(
      `https://example.com/signup?code=${result.generated![0].code}`,
    );
    expect(mockSend).toHaveBeenCalledOnce();
    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.TableName).toBe('test-invite-codes');
    expect(cmd.Item.pk).toBe('INVITE_CODE');
    expect(cmd.Item.sk).toMatch(/^CODE#[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  });

  it('generate: creates multiple codes from comma-separated labels', async () => {
    const result = await handler({ action: 'generate', labels: 'Alex, Bob, Sam' });
    expect(result.generated).toHaveLength(3);
    expect(result.generated![0].label).toBe('Alex');
    expect(result.generated![1].label).toBe('Bob');
    expect(result.generated![2].label).toBe('Sam');
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('generate: labels field overrides label field', async () => {
    const result = await handler({ action: 'generate', labels: 'Alice, Bob', label: 'ignored' });
    expect(result.generated).toHaveLength(2);
  });

  it('generate: creates one unlabelled code when neither label nor labels provided', async () => {
    const result = await handler({ action: 'generate' });
    expect(result.generated).toHaveLength(1);
    expect(result.generated![0].label).toBe('');
  });

  it('generate: is case-insensitive for action', async () => {
    const result = await handler({ action: 'GENERATE', label: 'Test' });
    expect(result.generated).toHaveLength(1);
  });

  it('generate: stores expiresAt 30 days from now', async () => {
    const before = Math.floor(Date.now() / 1000) + 30 * 86400;
    await handler({ action: 'generate', label: 'Test' });
    const after = Math.floor(Date.now() / 1000) + 30 * 86400;
    const expiresAt = mockSend.mock.calls[0][0].Item.expiresAt as number;
    expect(expiresAt).toBeGreaterThanOrEqual(before - 2);
    expect(expiresAt).toBeLessThanOrEqual(after + 2);
  });

  // ── list ──────────────────────────────────────────────────────────────

  it('list: returns ACTIVE, USED, and EXPIRED statuses correctly', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    mockSend.mockResolvedValue({
      Items: [
        { pk: 'INVITE_CODE', sk: 'CODE#AAAAAAAA', code: 'AAAAAAAA', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: nowSec + 1000 },
        { pk: 'INVITE_CODE', sk: 'CODE#BBBBBBBB', code: 'BBBBBBBB', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: nowSec + 1000, usedAt: '2026-01-02T00:00:00.000Z', usedBy: 'a@b.com' },
        { pk: 'INVITE_CODE', sk: 'CODE#CCCCCCCC', code: 'CCCCCCCC', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: nowSec - 1000 },
      ],
    });
    const result = await handler({ action: 'list' });
    expect(result.codes![0].status).toBe('ACTIVE');
    expect(result.codes![1].status).toBe('USED');
    expect(result.codes![1].usedBy).toBe('a@b.com');
    expect(result.codes![2].status).toBe('EXPIRED');
    result.codes!.forEach(c => {
      expect(c.inviteUrl).toMatch(/^https:\/\/example\.com\/signup\?code=/);
    });
  });

  it('list: returns empty array when no codes exist', async () => {
    mockSend.mockResolvedValue({ Items: [] });
    const result = await handler({ action: 'list' });
    expect(result.codes).toEqual([]);
  });

  // ── revoke ────────────────────────────────────────────────────────────

  it('revoke: deletes an unused code', async () => {
    const result = await handler({ action: 'revoke', code: 'ABCDEFGH' });
    expect(result.revoked).toBe('ABCDEFGH');
    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.Key).toEqual({ pk: 'INVITE_CODE', sk: 'CODE#ABCDEFGH' });
    expect(cmd.ConditionExpression).toContain('attribute_not_exists(usedAt)');
  });

  it('revoke: throws when code is missing from event', async () => {
    await expect(handler({ action: 'revoke' })).rejects.toThrow('code is required');
  });

  it('revoke: throws when code is already used (ConditionalCheckFailedException)', async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error('condition'), { name: 'ConditionalCheckFailedException' }),
    );
    await expect(handler({ action: 'revoke', code: 'ABCDEFGH' })).rejects.toThrow(
      'already used',
    );
  });

  // ── unknown action ────────────────────────────────────────────────────

  it('throws on unknown action', async () => {
    await expect(handler({ action: 'delete' })).rejects.toThrow('Unknown action');
  });
});
