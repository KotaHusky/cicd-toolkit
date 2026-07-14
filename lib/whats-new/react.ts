/**
 * React bindings for the what's-new summaries. Requires react (optional
 * peer dependency) — apps without React import from './index' instead.
 *
 * Usage:
 *   const { release, loading } = useWhatsNew();
 *   if (release) return <p>{release.title} — {release.summary}</p>;
 */
import { useEffect, useState } from 'react';
import {
  fetchReleaseHistory,
  fetchWhatsNew,
  FetchWhatsNewOptions,
  WhatsNewRelease,
} from './index';

export interface UseWhatsNewResult {
  release: WhatsNewRelease | null;
  loading: boolean;
}

export function useWhatsNew(options: FetchWhatsNewOptions = {}): UseWhatsNewResult {
  const [release, setRelease] = useState<WhatsNewRelease | null>(null);
  const [loading, setLoading] = useState(true);
  const path = options.path;
  useEffect(() => {
    let cancelled = false;
    fetchWhatsNew({ path }).then((r) => {
      if (!cancelled) {
        setRelease(r);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return { release, loading };
}

export interface UseReleaseHistoryResult {
  releases: WhatsNewRelease[];
  loading: boolean;
}

export function useReleaseHistory(
  options: FetchWhatsNewOptions = {},
): UseReleaseHistoryResult {
  const [releases, setReleases] = useState<WhatsNewRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const path = options.path;
  useEffect(() => {
    let cancelled = false;
    fetchReleaseHistory({ path }).then((r) => {
      if (!cancelled) {
        setReleases(r);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return { releases, loading };
}
