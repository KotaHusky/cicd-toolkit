/**
 * Types and fetch helpers for the end-user "what's new" summaries produced
 * by release.yml and baked into app builds via the `whats-new-path` input on
 * static-s3-deploy.yml / docker-ghcr.yml.
 *
 * Framework-agnostic and dependency-free. React bindings: `./react`.
 */

export interface WhatsNewRelease {
  /**
   * Contract version of the artifact (see schemas/whats-new.schema.json).
   * Absent on artifacts produced before the field existed — treat as 1.
   */
  schemaVersion?: number;
  /** Semver without the leading v, e.g. "1.4.0". */
  version: string;
  /** ISO date (YYYY-MM-DD) the release was published. */
  date: string;
  /** Short plain-language headline, e.g. "Faster meal planning". */
  title: string;
  /** 1-2 sentence plain-language overview. */
  summary: string;
  /** Up to 5 short user-facing bullets. */
  highlights: string[];
}

/**
 * Minimal structural fetch type — keeps this module compilable without the
 * DOM lib (this package's tsconfig targets Node/CDK). Any real fetch
 * implementation satisfies it.
 */
export type FetchLike = (input: string) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

export interface FetchWhatsNewOptions {
  /**
   * Path or URL of the JSON. Defaults: '/whats-new.json' (latest) or
   * '/releases.json' (history) — where the deploy workflows bake them.
   */
  path?: string;
  /** Injectable fetch implementation (tests, SSR). Defaults to globalThis.fetch. */
  fetchFn?: FetchLike;
}

/** Validate an unknown value into a WhatsNewRelease, or null. */
export function parseWhatsNew(data: unknown): WhatsNewRelease | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (
    typeof d.version !== 'string' ||
    typeof d.date !== 'string' ||
    typeof d.title !== 'string' ||
    typeof d.summary !== 'string' ||
    !Array.isArray(d.highlights) ||
    !d.highlights.every((h) => typeof h === 'string')
  ) {
    return null;
  }
  return {
    schemaVersion: typeof d.schemaVersion === 'number' ? d.schemaVersion : 1,
    version: d.version,
    date: d.date,
    title: d.title,
    summary: d.summary,
    highlights: d.highlights as string[],
  };
}

async function fetchJson(path: string, fetchFn?: FetchLike): Promise<unknown> {
  const f = fetchFn ?? (globalThis as { fetch?: FetchLike }).fetch;
  if (!f) return null;
  try {
    const res = await f(path);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * The deployed version's summary, or null when absent or invalid (e.g. no
 * release exists yet, or the deploy didn't enable whats-new-path). Callers
 * should treat null as "show nothing".
 */
export async function fetchWhatsNew(
  options: FetchWhatsNewOptions = {},
): Promise<WhatsNewRelease | null> {
  const data = await fetchJson(options.path ?? '/whats-new.json', options.fetchFn);
  return parseWhatsNew(data);
}

/** Release history, newest first. Empty array when absent or invalid. */
export async function fetchReleaseHistory(
  options: FetchWhatsNewOptions = {},
): Promise<WhatsNewRelease[]> {
  const data = await fetchJson(options.path ?? '/releases.json', options.fetchFn);
  if (!Array.isArray(data)) return [];
  return data
    .map(parseWhatsNew)
    .filter((r): r is WhatsNewRelease => r !== null);
}
