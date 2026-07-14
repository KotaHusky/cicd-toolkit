import { describe, expect, it } from 'vitest';
import {
  fetchReleaseHistory,
  fetchWhatsNew,
  parseWhatsNew,
  FetchLike,
} from '../lib/whats-new/index';

const valid = {
  version: '1.4.0',
  date: '2026-07-14',
  title: 'Faster meal planning',
  summary: 'Planning a week of meals is now quicker and more reliable.',
  highlights: ['Meal plans load faster', 'Fixed a bug in pantry counts'],
};

function stubFetch(status: number, body: unknown): FetchLike {
  return async () => ({
    ok: status >= 200 && status < 300,
    json: async () => body,
  });
}

function failingFetch(): FetchLike {
  return async () => {
    throw new Error('network down');
  };
}

describe('parseWhatsNew', () => {
  it('accepts a valid release, defaulting schemaVersion to 1', () => {
    expect(parseWhatsNew(valid)).toEqual({ ...valid, schemaVersion: 1 });
  });

  it('preserves an explicit schemaVersion', () => {
    expect(parseWhatsNew({ ...valid, schemaVersion: 1 })?.schemaVersion).toBe(1);
  });

  it('rejects missing fields', () => {
    const { title: _title, ...noTitle } = valid;
    expect(parseWhatsNew(noTitle)).toBeNull();
  });

  it('rejects wrong types', () => {
    expect(parseWhatsNew({ ...valid, highlights: 'not-an-array' })).toBeNull();
    expect(parseWhatsNew({ ...valid, highlights: [1, 2] })).toBeNull();
    expect(parseWhatsNew(null)).toBeNull();
    expect(parseWhatsNew('str')).toBeNull();
  });
});

describe('fetchWhatsNew', () => {
  it('returns the release on success', async () => {
    const release = await fetchWhatsNew({ fetchFn: stubFetch(200, valid) });
    expect(release?.version).toBe('1.4.0');
  });

  it('returns null on 404 (no release yet)', async () => {
    expect(await fetchWhatsNew({ fetchFn: stubFetch(404, {}) })).toBeNull();
  });

  it('returns null on invalid payload', async () => {
    expect(await fetchWhatsNew({ fetchFn: stubFetch(200, { nope: true }) })).toBeNull();
  });

  it('returns null on network error', async () => {
    expect(await fetchWhatsNew({ fetchFn: failingFetch() })).toBeNull();
  });
});

describe('fetchReleaseHistory', () => {
  it('returns valid entries, filtering invalid ones', async () => {
    const releases = await fetchReleaseHistory({
      fetchFn: stubFetch(200, [valid, { junk: true }, { ...valid, version: '1.3.0' }]),
    });
    expect(releases.map((r) => r.version)).toEqual(['1.4.0', '1.3.0']);
  });

  it('returns [] when absent or not an array', async () => {
    expect(await fetchReleaseHistory({ fetchFn: stubFetch(404, {}) })).toEqual([]);
    expect(await fetchReleaseHistory({ fetchFn: stubFetch(200, valid) })).toEqual([]);
  });
});
