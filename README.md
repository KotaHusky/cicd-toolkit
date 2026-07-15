# cicd-toolkit

[![Build Verify](https://img.shields.io/badge/workflow-build--verify-blue?logo=githubactions&logoColor=white)](#build-verification)
[![Commitlint](https://img.shields.io/badge/workflow-commitlint-blue?logo=conventionalcommits&logoColor=white)](#commitlint)
[![Docker GHCR](https://img.shields.io/badge/workflow-docker--ghcr-blue?logo=docker&logoColor=white)](#docker-build--push-to-ghcr)
[![CDK Deploy](https://img.shields.io/badge/workflow-cdk--deploy-blue?logo=amazonaws&logoColor=white)](#cdk-deploy)
[![Static S3](https://img.shields.io/badge/workflow-static--s3--deploy-blue?logo=amazonaws&logoColor=white)](#static-site-deploy-s3--cloudfront)
[![AI Release](https://img.shields.io/badge/workflow-release-blue?logo=anthropic&logoColor=white)](#ai-powered-release)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Reusable GitHub Actions workflows for CI/CD. Call them from any repo with `workflow_call`.

**cicd-toolkit** is an opinionated delivery platform in a repo: wire a few
caller files into any project and it gets verified builds with AI code review,
deploys to AWS / Azure / Cloudflare, fully automatic semver releases with
engineer notes *and* end-user-facing "what's new" feeds, and the operational
guardrails a small team never gets around to building — approval-gated
promotion, one-click rollback, policy scanning, build provenance, self-healing
releases, and an AI doctor that triages red CI. Everything is consumed at
`@main` (or pinned), so fixes ship to every project on merge. A bundled
[Claude Code plugin](#claude-code-plugin) teaches AI agents in consumer repos
to integrate all of it themselves.

## Capabilities

| Capability | Provided by | Notes |
|---|---|---|
| CI: build, test, lint (Turborepo-aware) | [`build-verify.yml`](#build-verification) | Node 24, npm/pnpm, shared cache |
| AI code review on every PR | embedded in [`build-verify.yml`](#build-verification), standalone [`claude-review.yml`](#claude-code-review) | Inline + sticky comments; opt-in [test-gap analysis](#build-verification); enforced finding disposition via the [Review Threads gate](#build-verification) |
| Conventional-commit enforcement | [`commitlint.yml`](#commitlint) | The contract that powers automatic versioning |
| Container images | [`docker-ghcr.yml`](#docker-build--push-to-ghcr) | BuildKit provenance; opt-in [attestations](#docker-build--push-to-ghcr) |
| Deploy: AWS CDK | [`cdk-deploy.yml`](#cdk-deploy) + [`cdk-synth.yml`](#cdk-deploy) PR check | OIDC auth; default-on report-only [checkov policy scan](#cdk-deploy) |
| Per-PR preview environments | [`preview-s3-deploy.yml`](#preview-environments) | Sticky preview URL; auto-teardown on close; needs base-path-aware builds |
| Deploy: static sites | [`static-s3-deploy.yml`](#static-site-deploy-s3--cloudfront) | S3 + CloudFront + cache strategy |
| Deploy: containers on ECS | [`ecs-express-deploy.yml` / `ecs-express-app-deploy.yml`](#ecs-express-deploy) | GHCR→ECR mirror, edge stack, dev/prod |
| Deploy: Azure Container Apps | [`aca-provision.yml` + `aca-deploy.yml`](#azure-container-apps) | Bicep + Azure OIDC |
| DNS | [`cloudflare-dns.yml`](#cloudflare-dns) | Record upsert + cache purge |
| Staged promotion, deployment tracking, rollback | [Environments, Promotion & Rollback](#environments-promotion--rollback) | GitHub Environments gates; DORA raw data; redeploy-a-tag rollback |
| Automatic releases | [`auto-version.yml`](#automatic-versioning) → [`release.yml`](#ai-powered-release) | Merge to main = release; AI notes; orphan self-heal |
| End-user release notes in your app | [What's-New summaries](#end-user-whats-new-summaries) + `lib/whats-new` | Curated context, redaction judge, deny-list |
| Red-CI triage | [`ci-doctor.yml`](#ci-doctor) | AI diagnosis issue, auto-closed on recovery |
| AWS infra building blocks | [CDK constructs](#cdk-constructs) | Static site, ECS edge, OIDC bootstrap, dashboards |
| Agent-assisted integration | [Claude Code plugin](#claude-code-plugin) | Skills for wiring workflows, secrets, OIDC |

## Table of Contents

<!-- TOC:BEGIN -->
- [Workflows](#workflows)
  - [Build Verification](#build-verification)
  - [Commitlint](#commitlint)
  - [Docker Build & Push to GHCR](#docker-build--push-to-ghcr)
  - [CDK Deploy](#cdk-deploy)
  - [Static Site Deploy (S3 + CloudFront)](#static-site-deploy-s3--cloudfront)
  - [Preview Environments](#preview-environments)
  - [ECS Express Deploy](#ecs-express-deploy)
  - [Azure Container Apps](#azure-container-apps)
  - [Cloudflare DNS](#cloudflare-dns)
  - [Environments, Promotion & Rollback](#environments-promotion--rollback)
  - [AI-Powered Release](#ai-powered-release)
  - [Automatic Versioning](#automatic-versioning)
  - [End-User What's-New Summaries](#end-user-whats-new-summaries)
  - [Claude Code Review](#claude-code-review)
  - [CI Doctor](#ci-doctor)
- [Composite actions](#composite-actions)
- [Setup](#setup)
  - [Secrets](#secrets)
  - [Pinning & Versions](#pinning--versions)
  - [OIDC Bootstrap (CDK Deploy)](#oidc-bootstrap-cdk-deploy)
- [CDK constructs](#cdk-constructs)
  - [`StaticSiteStack` (S3 + CloudFront, optional ACM + Route 53)](#staticsitestack-s3--cloudfront-optional-acm--route-53)
  - [`applyTags(scope, tags)`](#applytagsscope-tags)
  - [`StaticSiteDashboard`](#staticsitedashboard)
  - [`EcsExpressEdgeStack` (CloudFront in front of ECS Express)](#ecsexpressedgestack-cloudfront-in-front-of-ecs-express)
  - [`OidcBootstrapStack` (GitHub → AWS OIDC provider + deploy roles)](#oidcbootstrapstack-github--aws-oidc-provider--deploy-roles)
  - [`EcsExpressDashboard` / `ecs-express-observability`](#ecsexpressdashboard--ecs-express-observability)
- [Examples](#examples)
- [Claude Code plugin](#claude-code-plugin)
- [Claude PR review](#claude-pr-review)
- [License](#license)
<!-- TOC:END -->

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
| `require-resolved-review-threads` | boolean | `true` | Status check that fails while the PR has unresolved review threads — findings must be fixed or resolved-with-a-reply before merge. Needs `pull-requests: read` on the caller (no-ops with a notice otherwise). Don't mark it a *required* branch check unless every PR runs it: skipped paths (bot PRs, `push` events, opt-out) leave a required check stuck on "Expected" |
| `review-test-gaps` | boolean | `false` | Also analyze test coverage of the changed lines — flags changed code paths whose tests were not updated |

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
| `attest` | boolean | `false` | Publish a GitHub build-provenance attestation for the pushed image. Caller must grant `id-token: write` and `attestations: write` |

| Output | Description |
|--------|-------------|
| `tags` | Generated image tags |
| `digest` | Image digest |

**Provenance & attestations:** images build with BuildKit provenance (`mode=max`) by default; setting `attest: true` additionally publishes a [GitHub artifact attestation](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations) binding the image digest to the exact workflow run. Consumers can verify with `gh attestation verify oci://ghcr.io/<owner>/<image>@<digest> -R <owner>/<repo>`. Requires the caller to grant `id-token: write` + `attestations: write`.

### CDK Deploy

**`cdk-deploy.yml`** — Deploy AWS CDK applications via GitHub Actions with OIDC authentication.

```yaml
jobs:
  deploy:
    uses: KotaHusky/cicd-toolkit/.github/workflows/cdk-deploy.yml@main
    permissions:
      id-token: write   # OIDC to AWS
      contents: read
    with:
      aws-region: 'us-east-1'
      cdk-context: 'env=prod projectName=my-app'
    secrets:
      role-arn: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
```

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `cdk-context` | string | — | Space-separated `key=value` context pairs passed as `-c` flags (required) |
| `aws-region` | string | `us-east-1` | AWS region |
| `node-version` | string | `24` | Node.js version |
| `stacks` | string | `--all` | Stacks to deploy |
| `stack-prefix` | string | `''` | Stack name prefix; enables stuck-CloudFormation-stack recovery |
| `method` | string | `change-set` | Deploy method: `change-set` (safe) or `direct` (faster, no rollback) |
| `hotswap` | string | `off` | `off`, `fallback` (try hotswap, fall back to CFN), or `force` |

See the workflow file for the full list (`pre-build-filter`, `concurrency`, `run-diff`, `recover-stacks`, `checkout-ref`).

| Secret | Required | Description |
|--------|----------|-------------|
| `role-arn` | yes | ARN of the IAM role to assume via OIDC |

**PR check:** `cdk-synth.yml` is the synth-only companion — it runs `cdk synth` with no AWS credentials or secrets, so use it as the pull-request gate to catch template errors before merge (inputs: `node-version`, `pre-build-filter`, `cdk-context`, all optional). See [`examples/cdk-deploy.yml`](examples/cdk-deploy.yml) for the paired PR-synth + main-deploy layout.

**Policy scan:** `cdk-synth.yml` also runs a [checkov](https://www.checkov.io/) policy scan over the synthesized CloudFormation (`policy-scan`, default `true`). Report-only by default (`policy-soft-fail: true`) — findings land in the job summary and a `policy-scan-results` artifact without failing the check; set `policy-soft-fail: false` to enforce.


### Static Site Deploy (S3 + CloudFront)

**`static-s3-deploy.yml`** — Build a static site (Next.js `output: 'export'`, Astro, SvelteKit, Vite, plain HTML), sync to S3, invalidate CloudFront. Pair with the [`StaticSiteStack`](#staticsitestack-s3--cloudfront-optional-acm--route-53) CDK construct below for one-shot infra.

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

### Preview Environments

**`preview-s3-deploy.yml`** — Per-PR preview deploys for static sites: each PR's build lands at `s3://<bucket>/previews/pr-<N>/`, a sticky comment posts the preview URL, and closing the PR tears the prefix down. Pairs with the production `static-s3-deploy.yml` on the same bucket/distribution — production syncs exclude the reserved `previews/` prefix, so a prod deploy (even with `sync-delete: true`) never touches live previews.

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  preview:
    uses: KotaHusky/cicd-toolkit/.github/workflows/preview-s3-deploy.yml@main
    permissions:
      id-token: write   # OIDC to AWS
      contents: read
      pull-requests: write   # sticky preview-URL comment
    with:
      bucket-name: my-site-bucket
      distribution-id: E1234567ABCDEF
      preview-domain: site.example.com
    secrets:
      role-arn: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
```

Two consumer requirements: the app's build must honor `PREVIEW_BASE_PATH` (exported as `/previews/pr-<N>` before the build — e.g. Next.js `basePath: process.env.PREVIEW_BASE_PATH ?? ''`), and the serving `StaticSiteStack` needs `previewIndexRewrite: true` so CloudFront resolves directory indexes under subpaths. Inputs mirror `static-s3-deploy.yml` (node-version, package-manager, build-command, build-output-dir, working-directory, build-args) plus `preview-domain` (required). Output: `preview-url`. Teardown deletes only the PR's own `previews/pr-<N>` prefix (pattern-guarded) and updates the comment. See [`examples/preview-env.yml`](examples/preview-env.yml).

### ECS Express Deploy

**`ecs-express-app-deploy.yml`** — End-to-end deploy of a containerized app to ECS Express Mode behind CloudFront: builds the image to GHCR, mirrors it to ECR, deploys the Express service, then deploys a CloudFront edge stack from the caller's `infra/` CDK app (a thin `bin/app.ts` instantiating `EcsExpressEdgeStack`). The environment derives from the caller's trigger: `push` → prod, `pull_request` → dev (gated on a `deploy:dev` PR label), `workflow_dispatch` → the `environment` input. DNS is on Cloudflare — after the first deploy, add a CNAME from the domain to the distribution domain.

```yaml
jobs:
  deploy:
    uses: KotaHusky/cicd-toolkit/.github/workflows/ecs-express-app-deploy.yml@main
    permissions:
      contents: read
      packages: write
      id-token: write
    with:
      app: my-app                    # GHCR image name + ECR repo + prod service name
      stack-prefix: MyApp            # CDK stacks: MyAppProd / MyAppDev
      prod-domain: app.example.com
      dev-domain: dev.app.example.com
      prod-cert-arn: arn:aws:acm:us-east-1:123456789012:certificate/aaaa-bbbb
      dev-cert-arn: arn:aws:acm:us-east-1:123456789012:certificate/cccc-dddd
      aws-account-id: '123456789012'
    secrets:
      role-arn: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
      execution-role-arn: ${{ secrets.ECS_EXECUTION_ROLE_ARN }}
      infrastructure-role-arn: ${{ secrets.ECS_INFRASTRUCTURE_ROLE_ARN }}
```

Key inputs (see the workflow file for the full list):

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `app` | string | — | App slug: GHCR image name + ECR repo + prod service name (required) |
| `stack-prefix` | string | — | CDK stack id prefix; stacks are `<prefix>Prod` / `<prefix>Dev` (required) |
| `prod-domain` / `dev-domain` | string | — | Domains per environment (required) |
| `prod-cert-arn` / `dev-cert-arn` | string | — | us-east-1 ACM cert ARNs per domain (required) |
| `aws-account-id` | string | — | Target AWS account (required) |
| `aws-region` | string | `us-east-1` | AWS region |
| `container-port` | number | `3000` | Container port that receives traffic |
| `cpu` / `memory` | string | `256` / `512` | Fargate sizing (floor values; raise for heavier apps) |
| `health-check-path` | string | `/api/health` | ALB health-check path |
| `prod-bake-minutes` | string | `0` | Prod canary bake; `0` promotes as soon as healthy. Dev is always `0` |

| Secret | Required | Description |
|--------|----------|-------------|
| `role-arn` | yes | IAM role for AWS authentication via OIDC |
| `execution-role-arn` | yes | ECS task execution role (pulls image, writes logs) |
| `infrastructure-role-arn` | yes | ECS infrastructure role (manages ALB/target groups/SGs) |
| `node-auth-token` | no | PAT (`read:packages`) for private npm deps during the image build |

**`ecs-express-deploy.yml`** — the lower-level building block: points an ECS Express service at an existing container image (creating the service on first deploy) and manages canary bake time, auto-scaling, and health checks. Use it directly when you bring your own image and edge/infra pipeline — see [`examples/ecs-express.yml`](examples/ecs-express.yml). Takes the same three role-ARN secrets as above (`node-auth-token` not needed).

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `service-name` | string | — | ECS Express service name (required) |
| `image` | string | — | Full container image URI (required) |
| `aws-region` | string | `us-east-1` | AWS region |
| `cluster` | string | `''` | ECS cluster (Express Mode creates one if omitted) |
| `container-port` | number | `80` | Container port that receives traffic |
| `cpu` / `memory` | string | `512` / `1024` | Fargate sizing |
| `bake-time-minutes` | string | `''` | Canary bake (mins); `0` promotes as soon as healthy, empty keeps the service default |
| `health-check-path` | string | `/` | ALB health-check path |
| `min-task-count` / `max-task-count` | number | `1` / `3` | Auto-scaling floor / ceiling |

…plus env vars, container secrets, command, networking (subnets/security groups), task role, and tags — see the workflow file.

| Output | Description |
|--------|-------------|
| `service-arn` | ARN of the deployed Express service |
| `endpoint` | Public endpoint URL (ALB DNS name) |

### Azure Container Apps

**`aca-provision.yml`** + **`aca-deploy.yml`** — Provision Container Apps infrastructure from a Bicep template (Day-2 updates; the very first bootstrap runs locally, see [`examples/aca.yml`](examples/aca.yml)), then deploy a container image to the app. Both authenticate via Azure OIDC federated credentials — grant the calling workflow `id-token: write`.

```yaml
permissions:
  id-token: write   # OIDC login to Azure
  contents: read

jobs:
  provision:
    uses: KotaHusky/cicd-toolkit/.github/workflows/aca-provision.yml@main
    with:
      resource-group: my-app-rg
    secrets:
      AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
      AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
      AZURE_SUBSCRIPTION_ID: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

  deploy:
    needs: provision
    uses: KotaHusky/cicd-toolkit/.github/workflows/aca-deploy.yml@main
    with:
      resource-group: my-app-rg
      container-app-name: my-app
      image: ghcr.io/<owner>/my-app:latest
    secrets:
      AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
      AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
      AZURE_SUBSCRIPTION_ID: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

`aca-provision.yml` inputs:

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `resource-group` | string | — | Azure resource group name (required; created if missing) |
| `location` | string | `eastus` | Azure region |
| `bicep-file` | string | `infra/main.bicep` | Path to the Bicep template in the calling repo |

`aca-deploy.yml` inputs (see the workflow file for the full list):

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `resource-group` | string | — | Azure resource group name (required) |
| `container-app-name` | string | — | Container App name (required) |
| `image` | string | — | Full container image URI (required) |
| `target-port` | number | `3000` | Container listening port |
| `ingress` | string | `external` | `external` or `internal` |
| `container-app-environment` | string | `''` | Container App environment name (auto-created if missing) |

| Secret | Required | Description |
|--------|----------|-------------|
| `AZURE_CLIENT_ID` | yes | Entra ID app registration with a federated credential for the repo |
| `AZURE_TENANT_ID` | yes | Azure tenant |
| `AZURE_SUBSCRIPTION_ID` | yes | Azure subscription |
| `REGISTRY_TOKEN` | no | Registry password/token (deploy only; required if `registry-url` is set) |

| Output | Description |
|--------|-------------|
| `fqdn` | Deployed app FQDN (deploy only) |

### Cloudflare DNS

**`cloudflare-dns.yml`** — Create or update a DNS record via the Cloudflare API (upsert by name + type), with an optional full cache purge. Typical use: a post-deploy step pointing a CNAME at a CloudFront distribution domain or a Container Apps FQDN.

```yaml
jobs:
  dns:
    uses: KotaHusky/cicd-toolkit/.github/workflows/cloudflare-dns.yml@main
    with:
      record-name: app.example.com
      record-content: d1234567abcdef.cloudfront.net
    secrets:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ZONE_ID: ${{ secrets.CLOUDFLARE_ZONE_ID }}
```

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `record-name` | string | — | DNS record name, e.g. `app.example.com` (required) |
| `record-content` | string | — | Record content: IP address or hostname (required) |
| `record-type` | string | `CNAME` | `A`, `AAAA`, or `CNAME` |
| `proxied` | boolean | `true` | Cloudflare proxy (orange cloud) |
| `purge-cache` | boolean | `false` | Purge the whole zone cache after the update |

| Secret | Required | Description |
|--------|----------|-------------|
| `CLOUDFLARE_API_TOKEN` | yes | Token with Zone.DNS edit (plus Zone.Cache Purge if `purge-cache`) |
| `CLOUDFLARE_ZONE_ID` | yes | Zone ID from the zone's Overview page |

### Environments, Promotion & Rollback

All AWS deploy workflows (`cdk-deploy.yml`, `static-s3-deploy.yml`, `ecs-express-deploy.yml`, `ecs-express-app-deploy.yml`) accept two additional inputs (on `ecs-express-app-deploy.yml` the GitHub Environment input is named **`gh-environment`**, because its pre-existing `environment` input selects the dev|prod runtime env):

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `environment` | string | `''` | [GitHub Environment](https://docs.github.com/en/actions/deployment/targeting-different-environments) for the deploy job — enables approval gates, wait timers, and environment-scoped secrets. Empty = no environment |
| `track-deployment` | boolean | `false` | Record a GitHub Deployment + status per run (raw data for DORA metrics). Never fails the deploy; the caller must grant `deployments: write` or the steps notice-and-skip |

**Promotion pattern:** call the same reusable workflow twice with `environment: dev` (no protection) and `environment: prod` (required reviewers on the Environment) — GitHub pauses the prod job until approved.

**Rollback:** redeploy the old ref — see [`examples/rollback.yml`](examples/rollback.yml) for a `workflow_dispatch` rollback that points `checkout-ref` at a previous release tag. Infrastructure stays put; only the deployed artifact changes.

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

The workflow compares commits between the current and previous semver tags, sends the log to Claude, and creates a release titled `v1.2.0 — <AI-generated title>` whose body is the AI summary plus GitHub's generated "What's Changed" (PR-level changelog, Full Changelog compare link, and contributor credit). Mention-safe by construction: PR titles and any `@`/`#` tokens the summary echoes are code-spanned, so release notes can never @-mention unrelated users; the `by @author` attributions are the one intentional mention, driving the release's Contributors section. The commit-level changelog feeds the AI and (when `whats-new` is on) is uploaded as a run artifact rather than duplicated in the body.

**Auth:** when `CLAUDE_CODE_OAUTH_TOKEN` is set it is preferred — generation runs via the Claude Code CLI on your subscription (no GitHub App needed for releases; the CLI works on any trigger, including tag pushes and `auto-version.yml`'s main pushes). Otherwise `ANTHROPIC_API_KEY` is used via direct API calls. One of the two is required.

### Automatic Versioning

**`auto-version.yml`** — Make merging to `main` the whole release process: computes the next semver from [conventional commits](https://www.conventionalcommits.org/) since the last tag, creates the tag, and runs `release.yml` for it. Pair with `commitlint.yml` so commit messages are trustworthy.

```yaml
on:
  push:
    branches: [main]

jobs:
  auto-version:
    uses: KotaHusky/cicd-toolkit/.github/workflows/auto-version.yml@main
    permissions:
      contents: write
    secrets:
      CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

Bump rules (matching semantic-release defaults): `feat!:`/`BREAKING CHANGE` → major, `feat:` → minor, `fix:`/`perf:`/`revert:` → patch; anything else (docs, chore, ci, refactor, …) releases nothing. Merge commits are ignored.

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `initial-version` | string | `0.1.0` | First release when no semver tag exists yet (fires only once a releasable commit is present — a `chore:`-only history releases nothing) |
| `dry-run` | boolean | `false` | Report the computed bump without tagging or releasing |
| `floating-tags` | boolean | `false` | Advance floating `vN` / `vN.M` tags after the release (for repos consumed at a floating ref; leave off for apps) |
| `model` / `draft` / `app-context` / `whats-new` / `auto-publish` | — | — | Forwarded to `release.yml` (see above) |

| Output | Description |
|--------|-------------|
| `tag` | The created tag, or empty when nothing was releasable |
| `bump` | `major`, `minor`, `patch`, `none`, or `retry` (re-release of an orphaned tag) |

The tag is created with the run's `GITHUB_TOKEN`, whose events don't trigger other workflows — `release.yml` is invoked directly as a nested workflow, so no PAT is needed and a tag-push release workflow can coexist without double-releasing. Manual `v*.*.*` tags keep working as an escape hatch and become the new baseline for the next auto bump.

If a release run fails after tagging (leaving a tag with no GitHub Release), the next run — including a manual full re-run — detects the orphan and re-releases that tag instead of computing a new bump (`bump: retry`); commits merged in the meantime ship in the following release. The self-heal only fires in repos that already have at least one GitHub Release — adopting this workflow in a repo with plain unreleased git tags computes a normal bump from the latest tag rather than surprise-releasing it.

> **Pinning caveat:** the nested `release.yml` call inside `auto-version.yml` is fixed at `@main` (GitHub can't parameterize `uses:`), so pinning `auto-version.yml` to a tag or SHA does **not** transitively pin the release pipeline. If you need a fully pinned release path, call `release.yml@<ref>` yourself from a tag-push workflow instead.

**Tag-only variant:** `semver-tag.yml` is the lower-level workflow: it computes the conventional-commit bump and creates the `vX.Y.Z` tag (needs `contents: write`) but chains to **no** release — the caller wires downstream jobs off its outputs (`new-version`, `new-tag`, `bumped`, `changelog`) itself, as in [`examples/ecs-express.yml`](examples/ecs-express.yml). Its `default-bump` input (default `false` = no bump) can force a bump when no conventional commit calls for one. Prefer `auto-version.yml` unless you're composing the pipeline yourself.

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
| `review-test-gaps` | boolean | `false` | Also analyze test coverage of the changed lines — flags changed code paths whose tests were not updated |
| `require-resolved-review-threads` | boolean | `true` | Status check ("Review Threads Resolved") that fails while the PR has unresolved review threads — disposition each finding (fix, or resolve with a reply saying why) then re-run the failed gate job. Needs `pull-requests: read`; skips bot PRs. Don't mark it a *required* branch check unless every PR runs it — skipped paths leave a required check stuck on "Expected" |

| Secret | Required | Description |
|--------|----------|-------------|
| `ANTHROPIC_API_KEY` | one of | Anthropic API key (pay-per-token billing) |
| `CLAUDE_CODE_OAUTH_TOKEN` | one of | Claude Pro/Max OAuth token from `claude setup-token` (uses subscription quota) |

The review is advisory by default: if no credentials are available, or the review step itself errors, the run emits a **notice annotation** and the job still passes — the caller's CI is never blocked. Set `strict: true` to fail the job with an **error annotation** instead.

### CI Doctor

**`ci-doctor.yml`** — When CI fails on the default branch, Claude reads the failed run's logs and files (or updates) an issue labeled `ci-doctor` with root cause, evidence, and a suggested fix; the next successful run closes it automatically. Claude never gets GitHub write access — issues are managed by plain `gh` calls, and log content is treated as data, not instructions.

```yaml
on:
  workflow_run:
    workflows: [CI]
    types: [completed]

jobs:
  doctor:
    if: github.event.workflow_run.head_branch == github.event.repository.default_branch
    uses: KotaHusky/cicd-toolkit/.github/workflows/ci-doctor.yml@main
    permissions:
      contents: read
      issues: write
      actions: read
    with:
      run-id: ${{ github.event.workflow_run.id }}
      conclusion: ${{ github.event.workflow_run.conclusion }}
      workflow-name: ${{ github.event.workflow_run.name }}
    secrets:
      CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `run-id` | string | — | The completed workflow run to examine (required) |
| `conclusion` | string | — | `failure` diagnoses; `success` closes open `ci-doctor` issues (required) |
| `workflow-name` | string | — | Used in the issue title (required) |
| `model` | string | `claude-haiku-4-5` | Diagnosis model |
| `max-log-lines` | string | `400` | Log tail sent to the model |

Secrets: `CLAUDE_CODE_OAUTH_TOKEN` (preferred) or `ANTHROPIC_API_KEY`; with neither, a bare tracking issue with the run link is still filed. See [`examples/ci-doctor.yml`](examples/ci-doctor.yml).

## Composite actions

Step-level building blocks, referenced as `uses: KotaHusky/cicd-toolkit/actions/<name>@main` inside your own jobs (each has a full README):

- [`turbo-setup`](actions/turbo-setup/) — Node + npm cache + Turborepo remote cache in one step
- [`ecr-mirror`](actions/ecr-mirror/) — mirror a GHCR image (by digest) into ECR for ECS consumption
- [`cfn-recover`](actions/cfn-recover/) — unstick CloudFormation stacks in ROLLBACK_COMPLETE/FAILED states before a deploy

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

Every role the stack creates automatically gets `sts:AssumeRole` on the `cdk-*` bootstrap roles and account-scoped `cloudformation:ListStacks` (ListStacks doesn't support resource-level permissions — scoping it to stack ARNs silently denies it and CDK's rollback-detection pre-check logs `AccessDenied` on every deploy). Roles that deploy with `cdk deploy --method=direct` should also set `directDeployResourceOps: true` to get the Cloud Control API resource actions that mode requires.

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

### `EcsExpressEdgeStack` (CloudFront in front of ECS Express)

CloudFront distribution over an ECS Express service's ALB: custom-domain ACM cert, alias redirects, Next.js-aware cache behaviors (static assets long-cached, `/_next/image` query-string-aware), and opt-in tiered observability (dashboards + alarms via `observability: { tier: 'prod' | 'dev', alarmEmail }`). Pairs with [`ecs-express-app-deploy.yml`](#ecs-express-deploy), which synthesizes it from the consumer's thin CDK app.

### `OidcBootstrapStack` (GitHub → AWS OIDC provider + deploy roles)

One-time bootstrap: the GitHub OIDC provider plus a scoped deploy role per repo (`RepoRole[]`), each trust-limited to its repo/branch. Every role automatically gets `sts:AssumeRole` on the CDK bootstrap roles and account-scoped `cloudformation:ListStacks`; roles deploying with `cdk deploy --method=direct` opt into the Cloud Control grants via `directDeployResourceOps: true`. See [OIDC Bootstrap](#oidc-bootstrap-cdk-deploy) for the deploy flow and the `bootstrap-oidc` plugin skill for a guided run.

### `EcsExpressDashboard` / `ecs-express-observability`

CloudWatch dashboard (ALB + ECS service metrics) and the tiered alarm set used by `EcsExpressEdgeStack`'s `observability` prop — usable standalone for existing services.

## Examples

See [`examples/`](examples/) for ready-to-copy workflow files:

- [`aca.yml`](examples/aca.yml) — Azure Container Apps: Bicep provision + image deploy via Azure OIDC
- [`auto-version.yml`](examples/auto-version.yml) — Automatic versioning + AI release on every merge to main
- [`cdk-deploy.yml`](examples/cdk-deploy.yml) — CDK synth check on PRs, OIDC deploy on merge to main
- [`ci-doctor.yml`](examples/ci-doctor.yml) — AI diagnosis issue when default-branch CI goes red; auto-closes on recovery
- [`ci.yml`](examples/ci.yml) — Build verification + Docker push + commitlint
- [`claude-review.yml`](examples/claude-review.yml) — Claude PR review (inline comments + sticky summary)
- [`cloudflare-dns.yml`](examples/cloudflare-dns.yml) — Upsert a Cloudflare DNS record, optional cache purge
- [`docker-ghcr.yml`](examples/docker-ghcr.yml) — Build a Docker image and push it to GHCR
- [`ecs-express.yml`](examples/ecs-express.yml) — Tag-driven release for a containerized app on ECS Express Mode
- [`rollback.yml`](examples/rollback.yml) — One-click redeploy of a previous release tag via workflow_dispatch
- [`preview-env.yml`](examples/preview-env.yml) — Per-PR static-site preview deploys with auto-teardown
- [`release.yml`](examples/release.yml) — AI-powered release on tag push
- [`static-site.yml`](examples/static-site.yml) — Tag-driven release for an S3+CloudFront static site
- [`whats-new-context.md`](examples/whats-new-context.md) — Living context doc powering the end-user what's-new summaries

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
