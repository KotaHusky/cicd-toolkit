import * as cdk from 'aws-cdk-lib';
import { Annotations, Tags } from 'aws-cdk-lib';
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

/**
 * Standard cost-allocation / ownership tag set for cicd-toolkit stacks.
 *
 * `Project`, `Environment`, and `Repository` are REQUIRED — every deployable
 * stack must carry them so spend and ownership can be attributed. The remaining
 * fields are OPTIONAL refinements.
 *
 * Note: there is intentionally NO `ManagedBy` tag — it would be redundant with
 * the `aws:cloudformation:stack-name` tag AWS applies to every CloudFormation
 * resource.
 *
 * The index signature lets callers pass through additional ad-hoc tags and keeps
 * this interface assignable to `Record<string, string>` for {@link applyTags}.
 */
export interface StandardTags {
  /** Product / application the stack belongs to (e.g. "kiosk"). REQUIRED. */
  Project: string;
  /** Deployment environment (e.g. "production", "dev"). REQUIRED. */
  Environment: string;
  /** Source repository in `owner/repo` form (e.g. "KotaHusky/homepage"). REQUIRED. */
  Repository: string;
  /** Sub-service within the project (e.g. "frontend", "edge"). Optional. */
  Service?: string;
  /** Owning team or individual. Optional. */
  Owner?: string;
  /** Custom domain the stack serves (e.g. "example.com"). Optional. */
  Domain?: string;
  /** Billing / cost-center dimension. Optional. */
  CostCenter?: string;
  /** Pass-through for additional ad-hoc tags. */
  [key: string]: string | undefined;
}

/**
 * Tag keys that MUST be present (and non-blank) on every deployable stack.
 */
export const REQUIRED_STANDARD_TAG_KEYS = ['Project', 'Environment', 'Repository'] as const;

/**
 * Apply {@link StandardTags} to a construct, enforcing that every required key
 * ({@link REQUIRED_STANDARD_TAG_KEYS}) has a present, non-blank value.
 *
 * Throws before applying anything if any required tag is missing or blank (after
 * trimming), so a misconfigured stack fails fast at synth time rather than
 * silently deploying untagged. Optional tags with `undefined`/blank values are
 * skipped by {@link applyTags}.
 */
export function applyStandardTags(scope: IConstruct, tags: StandardTags): void {
  const missing = REQUIRED_STANDARD_TAG_KEYS.filter((key) => {
    const value = tags[key];
    return value === undefined || value === null || value.trim() === '';
  });
  if (missing.length > 0) {
    throw new Error(`applyStandardTags: missing required tag(s): ${missing.join(', ')}`);
  }
  applyTags(scope, tags as Record<string, string>);
}

/**
 * Defence-in-depth CDK Aspect that fails synthesis when a {@link cdk.Stack} is
 * missing any required standard tag. Optional for consumers who set tags by
 * some other mechanism (e.g. `Tags.of(app).add(...)` at the app level) and want
 * an independent guard rail regardless of how the tags were applied.
 *
 * Usage:
 * ```ts
 * Aspects.of(app).add(new RequireStandardTags());
 * ```
 */
export class RequireStandardTags implements cdk.IAspect {
  constructor(private readonly required: readonly string[] = REQUIRED_STANDARD_TAG_KEYS) {}

  public visit(node: IConstruct): void {
    if (!(node instanceof cdk.Stack)) return;
    const applied = node.tags.tagValues();
    for (const key of this.required) {
      const value = applied[key];
      if (value === undefined || value === null || value.trim() === '') {
        Annotations.of(node).addError(
          `RequireStandardTags: stack is missing required tag "${key}".`,
        );
      }
    }
  }
}
