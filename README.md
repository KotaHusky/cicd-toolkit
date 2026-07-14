# cicd-toolkit

[![Build Verify](https://img.shields.io/badge/workflow-build--verify-blue?logo=githubactions&logoColor=white)](#build-verification)
[![Commitlint](https://img.shields.io/badge/workflow-commitlint-blue?logo=conventionalcommits&logoColor=white)](#commitlint)
[![Docker GHCR](https://img.shields.io/badge/workflow-docker--ghcr-blue?logo=docker&logoColor=white)](#docker-build--push-to-ghcr)
[![CDK Deploy](https://img.shields.io/badge/workflow-cdk--deploy-blue?logo=amazonaws&logoColor=white)](#cdk-deploy)
[![Static S3](https://img.shields.io/badge/workflow-static--s3--deploy-blue?logo=amazonaws&logoColor=white)](#static-site-deploy-s3--cloudfront)
[![AI Release](https://img.shields.io/badge/workflow-release-blue?logo=anthropic&logoColor=white)](#ai-powered-release)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Reusable GitHub Actions workflows for CI/CD. Call them from any repo with `workflow_call`.

## Workflows

### Build Verification

**`build-verify.yml`** — Install, build, test, and lint a Node.js project with Turborepo caching.

```yaml
jobs:
  verify:
    uses: KotaHusky/cicd-toolkit/.github/workflows/build-verify.yml@main
    with:
      node-version: '24'
```

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `node-version` | string | `24` | Node.js version |
| `run-build` | boolean | `true` | Run the build step |
| `run-tests` | boolean | `true` | Run the test step |
| `run-lint` | boolean | `true` | Run the lint step |
| `package-manager` | string | `npm` | Package manager (`npm` or `pnpm`) |
| `claude-review` | boolean | `true` | Advisory Claude AI review on PRs; activates only when an Anthropic secret is passed |
| `claude-review-prompt` | string | `''` | Extra project-specific review instructions |

**Built-in Claude review:** when the caller passes `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` (directly or via `secrets: inherit`), pull requests get an advisory AI review (inline comments + sticky summary) with no extra workflow file. It never blocks CI: no credentials → skip with a notice; insufficient permissions → the review step is swallowed. For comments to post, grant the calling job `pull-requests: write` (see [Claude Code Review](#claude-code-review) for the standalone workflow and full permission block). Requires the [Claude GitHub App](https://github.com/apps/claude) on the repo. Set `claude-review: false` to opt out.

```yaml
jobs:
  verify:
    uses: KotaHusky/cicd-toolkit/.github/workflows/build-verify.yml@main
    permissions:
      contents: read
      pull-requests: write
      issues: read
      id-token: write
      actions: read
    secrets:
      CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

### Commitlint

**`commitlint.yml`** — Lint PR commit messages against [Conventional Commits](https://www.conventionalcommits.org/).

```yaml
jobs:
  commitlint:
    uses: KotaHusky/cicd-toolkit/.github/workflows/commitlint.yml@main
```

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `node-version` | string | `24` | Node.js version |

> **Requirement:** Consumer repo must have `@commitlint/cli` and a commitlint config (e.g. `@commitlint/config-conventional`) in `package.json`.

### Docker Build & Push to GHCR

**`docker-ghcr.yml`** — Build a Docker image and push it to GitHub Container Registry.

```yaml
jobs:
  docker:
    uses: KotaHusky/cicd-toolkit/.github/workflows/docker-ghcr.yml@main
    permissions:
      contents: read
      packages: write
```

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `image-name` | string | `ghcr.io/{repo}` | Image name override |
| `dockerfile` | string | `./Dockerfile` | Path to Dockerfile |
| `context` | string | `.` | Docker build context |
| `build-args` | string | | Build arguments (newline-separated) |
| `push` | boolean | `true` | Push image to registry |
| `platforms` | string | `linux/amd64` | Target platforms |
| `version` | string | | Semantic version (e.g. `1.2.3`). Adds `v1.2.3`, `v1.2`, `v1` tags. |

| Output | Description |
|--------|-------------|
| `tags` | Generated image tags |
| `digest` | Image digest |

### CDK Deploy

**`cdk-deploy.yml`** — Deploy AWS CDK applications via GitHub Actions with OIDC authentication.

```yaml
jobs:
  deploy:
    uses: KotaHusky/cicd-toolkit/.github/workflows/cdk-deploy.yml@main
    with:
      aws-region: 'us-east-1'
      node-version: '24'
    secrets:
      role-arn: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
```

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `aws-region` | string | `us-east-1` | AWS region |
| `node-version` | string | `24` | Node.js version |
| `working-directory` | string | `.` | Working directory |

| Secret | Required | Description |
|--------|----------|-------------|
| `role-arn` | yes | ARN of the IAM role to assume via OIDC |

### Static Site Deploy (S3 + CloudFront)

**`static-s3-deploy.yml`** — Build a static site (Next.js `output: 'export'`, Astro, SvelteKit, Vite, plain HTML), sync to S3, invalidate CloudFront. Pair with the [`StaticSiteStack`](#staticsitestack-s3--cloudfront--acm--route-53) CDK construct below for one-shot infra.

```yaml
jobs:
  deploy:
    uses: KotaHusky/cicd-toolkit/.github/workflows/static-s3-deploy.yml@main
    with:
      bucket-name: my-site-bucket
      distribution-id: E1234567ABCDEF
      build-output-dir: out          # Next 'out' / Vite 'dist' / Astro 'dist'
    secrets:
      role-arn: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
```

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `bucket-name` | string | — | S3 bucket hosting the site (required) |
| `distribution-id` | string | — | CloudFront distribution to invalidate (required) |
| `aws-region` | string | `us-east-1` | AWS region for the bucket |
| `node-version` | string | `24` | Node.js version |
| `package-manager` | string | `npm` | `npm` or `pnpm` |
| `build-command` | string | `npm run build` | Command that produces the static output |
| `build-output-dir` | string | `out` | Directory to upload (relative to working-directory) |
| `working-directory` | string | `.` | Repo subdirectory to run the build from |
| `invalidation-paths` | string | `/*` | Newline- or space-separated paths to invalidate |
| `sync-delete` | boolean | `true` | Pass `--delete` to `aws s3 sync` |
| `cache-control-immutable` | string | `_next/static/*` | Glob to upload with long-cache headers (empty disables) |
| `build-args` | string | | `KEY=VALUE` pairs (one per line) exported before the build |
| `checkout-ref` | string | | Git ref to check out (defaults to triggering ref) |

| Secret | Required | Description |
|--------|----------|-------------|
| `role-arn` | yes | OIDC role with `s3:Sync` and `cloudfront:CreateInvalidation` on the target resources |

| Output | Description |
|--------|-------------|
| `invalidation-id` | CloudFront invalidation ID |
| `objects-uploaded` | Count of objects synced (parsed from CLI output) |

### AI-Powered Release

**`release.yml`** — Create a GitHub Release with a Claude-generated title and summary when a semver tag is pushed.

```yaml
on:
  push:
    tags: ['v*']

jobs:
  release:
    uses: KotaHusky/cicd-toolkit/.github/workflows/release.yml@main
    permissions:
      contents: write
    secrets:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | string | `claude-haiku-4-5` | Claude model for notes + what's-new (fast/cheap fits this task) |
| `draft` | boolean | `false` | Create as draft release |
| `app-context` | string | `''` | End-user-facing app description for the public what's-new summary (combined with `.github/whats-new-context.md`) |
| `whats-new` | boolean | `true` | Also generate `whats-new.json` + `releases.json` release assets |
| `auto-publish` | boolean | `true` | When `false`, uploads `whats-new.draft.json` for human review instead |

| Secret | Required | Description |
|--------|----------|-------------|
| `CLAUDE_CODE_OAUTH_TOKEN` | one of | Claude Pro/Max OAuth token from `claude setup-token` — preferred; billed to subscription |
| `ANTHROPIC_API_KEY` | one of | Anthropic API key — pay-per-token fallback |

| Output | Description |
|--------|-------------|
| `release-url` | URL of the created release |

The workflow compares commits between the current and previous semver tags, sends the log to Claude, and creates a release titled `v1.2.0 — <AI-generated title>` with a summary and full changelog.

**Auth:** when `CLAUDE_CODE_OAUTH_TOKEN` is set it is preferred — generation runs via [claude-code-action](https://github.com/anthropics/claude-code-action) on your subscription (requires the [Claude GitHub App](https://github.com/apps/claude); note the action skips if the caller workflow file differs from the repo's default branch, so tag from a commit whose workflows match `main`). Otherwise `ANTHROPIC_API_KEY` is used via direct API calls. One of the two is required.

### End-User What's-New Summaries

Releases are **two-tier**: the GitHub Release body stays engineer-focused and specific, while `release.yml` additionally generates a plain-language, end-user-facing summary your app can display — a `whats-new.json` (latest) and cumulative `releases.json` (last 20) attached to each release as assets. The artifact contract is versioned (`schemaVersion: 1`) and published at [`schemas/whats-new.schema.json`](schemas/whats-new.schema.json).

**How it stays app-aware and leak-free:**

1. **Curated context** — the generator sees only the commit subjects plus `.github/whats-new-context.md` in your repo (copy [`examples/whats-new-context.md`](examples/whats-new-context.md)): app description, user vocabulary, tone, and a deny-list. It's the only app knowledge the summarizer gets — keep it updated as features change.
2. **Generation rules** — user-visible changes only; internal-only changes collapse to "Stability and performance improvements"; security fixes are never described specifically; commit text is treated as data, not instructions.
3. **Redaction judge** — a second Claude pass reviews the draft against the context file and rewrites anything that reveals internals.
4. **Mechanical deny-list** — publishing fails hard if any deny-listed term (yours + built-in defaults like `secret`, `token`) appears in the final text. The release itself is unaffected.

**Getting the summary into your app** — enable baking at deploy/build time so the app reads a local file that always matches the deployed version (no client-side GitHub API, works for private repos):

```yaml
# static sites (S3/CloudFront)
    uses: KotaHusky/cicd-toolkit/.github/workflows/static-s3-deploy.yml@main
    with:
      whats-new-path: public/whats-new.json

# container images (GHCR) — bakes into the build context pre-build
    uses: KotaHusky/cicd-toolkit/.github/workflows/docker-ghcr.yml@main
    with:
      whats-new-path: public/whats-new.json
```

**Rendering it** — import from this package (framework-agnostic core, optional React bindings):

```tsx
import { useWhatsNew } from 'cicd-toolkit/lib/whats-new/react';

function WhatsNewBanner() {
  const { release } = useWhatsNew(); // reads /whats-new.json
  if (!release) return null; // absent until the first release + deploy
  return (
    <aside>
      <h3>{release.title} <small>v{release.version}</small></h3>
      <p>{release.summary}</p>
      <ul>{release.highlights.map((h) => <li key={h}>{h}</li>)}</ul>
    </aside>
  );
}
```

Non-React apps use `fetchWhatsNew()` / `fetchReleaseHistory()` from `cicd-toolkit/lib/whats-new`. Next.js users: add `transpilePackages: ['cicd-toolkit']` since the package ships TypeScript sources.

### Claude Code Review

**`claude-review.yml`** — Automated Claude review on pull requests via [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action). Posts inline comments for line-specific findings plus one sticky summary comment that updates on new pushes.

Requires the [Claude GitHub App](https://github.com/apps/claude) to be installed on the consuming repo.

```yaml
on:
  pull_request:
    types: [opened, ready_for_review, synchronize]

jobs:
  review:
    uses: KotaHusky/cicd-toolkit/.github/workflows/claude-review.yml@main
    permissions:
      contents: read
      pull-requests: write
      issues: read
      id-token: write
      actions: read
    secrets:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

To source the key from a GitHub environment in the consuming repo instead of a repo secret, pass the environment name and inherit secrets (environment secrets only resolve with `secrets: inherit`):

```yaml
    with:
      environment: claude
    secrets: inherit
```

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `environment` | string | `''` | GitHub environment (in the calling repo) to source secrets from; requires `secrets: inherit` |
| `model` | string | `''` | Claude model override; empty uses the action default |
| `review-prompt` | string | `''` | Extra project-specific review instructions |
| `max-turns` | string | `25` | Max agent turns per review (cost control) |
| `strict` | boolean | `false` | Fail the job when the review can't run (missing credentials or a review error); default is a notice annotation and a passing job |

| Secret | Required | Description |
|--------|----------|-------------|
| `ANTHROPIC_API_KEY` | one of | Anthropic API key (pay-per-token billing) |
| `CLAUDE_CODE_OAUTH_TOKEN` | one of | Claude Pro/Max OAuth token from `claude setup-token` (uses subscription quota) |

The review is advisory by default: if no credentials are available, or the review step itself errors, the run emits a **notice annotation** and the job still passes — the caller's CI is never blocked. Set `strict: true` to fail the job with an **error annotation** instead.

## Setup

### Secrets

Consumer repos need to configure the following secrets depending on which workflows they use:

```bash
# For AI-powered releases (release.yml) and Claude code review (claude-review.yml)
gh secret set ANTHROPIC_API_KEY --repo <owner>/<repo>

# For CDK deployments (cdk-deploy.yml)
gh secret set AWS_DEPLOY_ROLE_ARN --repo <owner>/<repo>
```

Generate your Anthropic API key at [console.anthropic.com](https://console.anthropic.com/) under API Keys. For `claude-review.yml`, also install the [Claude GitHub App](https://github.com/apps/claude) on the repo; Claude Pro/Max subscribers can set `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) instead of an API key to draw on subscription usage rather than per-token billing.

### Pinning & Versions

All examples reference `@main` (bleeding edge — merges here ship to you immediately). Floating release tags are also maintained automatically on every release, so pick your stability tier:

| Ref | Behavior |
|-----|----------|
| `@main` | Latest, updates on every merge |
| `@v2` | Latest release in major 2 — advances on each release, breaking changes gated on `v3` |
| `@v2.5` | Latest patch of 2.5 |
| `@<sha>` | Fully pinned (maximum supply-chain rigor) |

Internally, this repo pins third-party actions to commit SHAs (OpenSSF practice); Dependabot keeps the pins current.

### OIDC Bootstrap (CDK Deploy)

For repos that need to deploy to AWS, bootstrap the OIDC provider and deploy role once:

```bash
npx cdk deploy --app "npx ts-node bin/bootstrap.ts"
```

This creates an IAM OIDC Provider for `token.actions.githubusercontent.com` and an IAM Role trusted by your GitHub org/repo. Store the role ARN as `AWS_DEPLOY_ROLE_ARN` in your repo secrets.

## CDK constructs

Reusable, project-agnostic constructs in [`lib/`](lib/). Import them into your own CDK app.

### `StaticSiteStack` (S3 + CloudFront, optional ACM + Route 53)

Private S3 bucket + CloudFront distribution with Origin Access Control. Optionally provisions an ACM cert (us-east-1) and a Route 53 A/AAAA alias when you want a custom domain. Outputs the bucket name and distribution ID for [`static-s3-deploy.yml`](#static-site-deploy-s3--cloudfront).

**Custom-domain mode** — pass `domainName` + `hostedZoneName`:

```ts
import { StaticSiteStack } from 'cicd-toolkit/lib/stacks/static-site-stack';

new StaticSiteStack(app, 'MySite', {
  env: { account: '123456789012', region: 'us-east-1' },
  domainName: 'site.example.com',
  hostedZoneName: 'example.com',
  spaFallback: false,                  // true → 403/404 → /index.html for SPAs
  additionalAliases: ['www.example.com'],
});
```

**Default-CloudFront-domain mode** — omit `domainName` entirely. No ACM cert, no DNS records; the site is reachable via the auto-generated `dXXXXX.cloudfront.net`. Useful for kiosk apps and internal tools where you *don't* want a memorable URL ("security by obscurity"):

```ts
new StaticSiteStack(app, 'MySite', {
  env: { account: '123456789012', region: 'us-east-1' },
  // no domainName — distribution served from its default *.cloudfront.net only
});
```

### `applyTags(scope, tags)`

Thin wrapper around `Tags.of()` that takes any flat tag map and skips blanks. Intentionally has **no opinion** on which keys you use — pass whatever convention your org has standardized.

```ts
import { applyTags } from 'cicd-toolkit/lib/constructs/standard-tags';

applyTags(stack, {
  Project: 'kiosk',
  Service: 'frontend',
  Environment: 'production',
  Owner: 'platform-team',
  CostCenter: 'cc-100',
  ManagedBy: 'cdk',
  Repository: 'owner/repo',
});
```

Enable any of those as **Cost Allocation Tags** in the Billing console to see spend grouped by them in Cost Explorer.

### `StaticSiteDashboard`

CloudWatch dashboard for a CloudFront distribution: requests, 4xx/5xx error rates, cache hit ratio, p50/p99 origin latency, bytes downloaded.

```ts
import { StaticSiteDashboard } from 'cicd-toolkit/lib/constructs/static-site-dashboard';

new StaticSiteDashboard(stack, 'SiteMetrics', {
  distribution: siteStack.distribution,
  dashboardName: 'kiosk-static-site',
});
```

## Examples

See [`examples/`](examples/) for ready-to-copy workflow files:

- [`ci.yml`](examples/ci.yml) — Build verification + Docker push + commitlint
- [`release.yml`](examples/release.yml) — AI-powered release on tag push
- [`static-site.yml`](examples/static-site.yml) — Tag-driven release for an S3+CloudFront static site

## Claude Code plugin

This repo hosts a [Claude Code plugin marketplace](https://code.claude.com/docs/en/plugins). Installing the plugin gives Claude, in any consumer repo, skills for picking the right workflow, wiring up the caller file, setting secrets securely, and bootstrapping AWS OIDC:

```
/plugin marketplace add KotaHusky/cicd-toolkit
/plugin install cicd-toolkit@cicd-toolkit
```

| Skill | What it does |
|---|---|
| `/integrate-cicd-toolkit` | Picks the right workflow, adapts a caller from `examples/`, and walks through secrets setup — including generating a `CLAUDE_CODE_OAUTH_TOKEN` via `claude setup-token` and storing any secret with a clipboard pipe (`pbpaste \| gh secret set …`) run in your own terminal, outside the Claude session, so values never enter the AI conversation. |
| `/bootstrap-oidc` | One-time GitHub → AWS OIDC provisioning via `bin/bootstrap.ts` (provider + deploy role), producing the `AWS_DEPLOY_ROLE_ARN` secret used by the AWS deploy workflows. |

## Claude PR review

Every PR to this repo is automatically reviewed by [`claude-review-self.yml`](.github/workflows/claude-review-self.yml), which dogfoods the reusable [`claude-review.yml`](.github/workflows/claude-review.yml) documented in [Workflows](#claude-code-review) — inline comments for line-specific findings plus one sticky summary, with a prompt tuned for reusable-workflow risks (shell pitfalls, breaking input changes, README/`examples/`/skills drift). Bot PRs are skipped. Credentials: the `CLAUDE_CODE_OAUTH_TOKEN` repo secret — run `claude setup-token` in a terminal, copy the token, then `pbpaste | gh secret set CLAUDE_CODE_OAUTH_TOKEN -R KotaHusky/cicd-toolkit` (all outside any Claude session).

## License

[MIT](LICENSE)
