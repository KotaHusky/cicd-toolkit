import { Tags } from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

/**
 * Apply a flat tag map to a construct (stack, single resource, or anything
 * with `Tags.of()` support). Every key in `tags` is added with `applyToLaunchedInstances`,
 * so the tags propagate to every taggable resource in the subtree — including
 * Auto Scaling Group launched instances.
 *
 * Intentionally generic: this helper has no opinion on which tags you should
 * use. Callers decide their own conventions. A typical set worth standardizing
 * across an organization:
 *   - Project       (e.g. "kiosk")
 *   - Service       (e.g. "frontend")
 *   - Environment   (e.g. "production")
 *   - Owner         (team or individual)
 *   - CostCenter    (billing dimension)
 *   - ManagedBy     (e.g. "cdk")
 *   - Repository    (e.g. "owner/repo")
 *
 * Enable any of those as Cost Allocation Tags in the Billing console to see
 * spend grouped by them in Cost Explorer.
 *
 * Skips empty values so callers can pass `process.env.X ?? ''` without
 * polluting resources with blank tags.
 */
export function applyTags(scope: IConstruct, tags: Record<string, string>): void {
  for (const [key, value] of Object.entries(tags)) {
    if (value === undefined || value === null || value === '') continue;
    Tags.of(scope).add(key, value);
  }
}
