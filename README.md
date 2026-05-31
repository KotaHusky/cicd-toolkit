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
| `model` | string | `claude-sonnet-4-5-20250929` | Claude model to use |
| `draft` | boolean | `false` | Create as draft release |

| Secret | Required | Description |
|--------|----------|-------------|
| `ANTHROPIC_API_KEY` | yes | Your Anthropic API key |

| Output | Description |
|--------|-------------|
| `release-url` | URL of the created release |

The workflow compares commits between the current and previous semver tags, sends the log to Claude, and creates a release titled `v1.2.0 — <AI-generated title>` with a summary and full changelog.

## Setup

### Secrets

Consumer repos need to configure the following secrets depending on which workflows they use:

```bash
# For AI-powered releases (release.yml)
gh secret set ANTHROPIC_API_KEY --repo <owner>/<repo>

# For CDK deployments (cdk-deploy.yml)
gh secret set AWS_DEPLOY_ROLE_ARN --repo <owner>/<repo>
```

Generate your Anthropic API key at [console.anthropic.com](https://console.anthropic.com/) under API Keys.

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

## License

[MIT](LICENSE)
