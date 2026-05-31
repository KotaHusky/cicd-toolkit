# cicd-toolkit

[![Build Verify](https://img.shields.io/badge/workflow-build--verify-blue?logo=githubactions&logoColor=white)](#build-verification)
[![Commitlint](https://img.shields.io/badge/workflow-commitlint-blue?logo=conventionalcommits&logoColor=white)](#commitlint)
[![Docker GHCR](https://img.shields.io/badge/workflow-docker--ghcr-blue?logo=docker&logoColor=white)](#docker-build--push-to-ghcr)
[![CDK Deploy](https://img.shields.io/badge/workflow-cdk--deploy-blue?logo=amazonaws&logoColor=white)](#cdk-deploy)
[![ECS Express](https://img.shields.io/badge/workflow-ecs--express-blue?logo=amazonaws&logoColor=white)](#ecs-express-deploy)
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

### ECS Express Deploy

**`ecs-express-deploy.yml`** — Deploy a container image to [Amazon ECS Express Mode](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-overview.html) (launched Nov 2025). Express Mode auto-provisions the Fargate service, ALB, target groups, security groups, and auto-scaling — you supply an image and two IAM roles.

```yaml
jobs:
  deploy:
    uses: KotaHusky/cicd-toolkit/.github/workflows/ecs-express-deploy.yml@main
    with:
      service-name: my-app
      image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app:v1.2.3
      container-port: 3000
      health-check-path: /api/health
    secrets:
      role-arn: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
      execution-role-arn: ${{ secrets.ECS_EXECUTION_ROLE_ARN }}
      infrastructure-role-arn: ${{ secrets.ECS_INFRASTRUCTURE_ROLE_ARN }}
```

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `service-name` | string | — | ECS Express service name (required) |
| `image` | string | — | Full container image URI (required) |
| `aws-region` | string | `us-east-1` | AWS region |
| `cluster` | string | | Existing cluster name (Express Mode creates one if omitted) |
| `container-port` | number | `80` | Port the container listens on |
| `cpu` | string | `512` | Fargate CPU units |
| `memory` | string | `1024` | Fargate memory in MiB |
| `environment-variables` | string | | JSON array `[{"name":"K","value":"V"}]` |
| `secrets-json` | string | | JSON array `[{"name":"K","valueFrom":"arn:..."}]` |
| `command` | string | | Container command override as JSON array |
| `health-check-path` | string | `/` | ALB health-check path |
| `min-task-count` | number | `1` | Auto-scaling floor |
| `max-task-count` | number | `3` | Auto-scaling ceiling |
| `auto-scaling-metric` | string | `AVERAGE_CPU` | `AVERAGE_CPU`, `AVERAGE_MEMORY`, or `REQUEST_COUNT_PER_TASK` |
| `auto-scaling-target-value` | number | `70` | Target value for the chosen metric |
| `subnets` | string | | Comma-separated subnet IDs (omit to use default VPC) |
| `security-groups` | string | | Comma-separated SG IDs |
| `task-role-arn` | string | | App-level IAM role for the running container |
| `tags` | string | | JSON array `[{"key":"K","value":"V"}]` |
| `checkout-ref` | string | | Git ref to check out (defaults to triggering ref) |

| Secret | Required | Description |
|--------|----------|-------------|
| `role-arn` | yes | OIDC role for the GitHub runner to call ECS APIs |
| `execution-role-arn` | yes | ECS task execution role (pulls image, writes logs) |
| `infrastructure-role-arn` | yes | ECS infra role (creates ALB / target groups / SGs) |

| Output | Description |
|--------|-------------|
| `service-arn` | ARN of the deployed Express service |
| `endpoint` | Public endpoint URL (ALB DNS name) |

> **Versioning:** pair with `semver-tag.yml` → `docker-ghcr.yml` (with `version:`) → `actions/ecr-mirror` → this workflow. See [`examples/ecs-express.yml`](examples/ecs-express.yml).

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

# For ECS Express deployments (ecs-express-deploy.yml)
gh secret set AWS_DEPLOY_ROLE_ARN --repo <owner>/<repo>
gh secret set ECS_EXECUTION_ROLE_ARN --repo <owner>/<repo>
gh secret set ECS_INFRASTRUCTURE_ROLE_ARN --repo <owner>/<repo>
```

### ECS Express IAM bootstrap (one-time per AWS account)

ECS Express Mode needs two task-level IAM roles in addition to the OIDC deploy role. Create them once per account:

```bash
# Execution role — pulls images, writes logs
aws iam create-role --role-name ecsTaskExecutionRole \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

# Infrastructure role — manages ALB/target groups/security groups for Express services
aws iam create-role --role-name ecsInfrastructureRole \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name ecsInfrastructureRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRolePolicyForLoadBalancers
```

Store both ARNs as repo secrets (`ECS_EXECUTION_ROLE_ARN`, `ECS_INFRASTRUCTURE_ROLE_ARN`). The deploy OIDC role (`AWS_DEPLOY_ROLE_ARN`) needs `ecs:*`, `iam:PassRole` for the two roles above, `elasticloadbalancing:*`, `ec2:Describe*`, `logs:*`, and `application-autoscaling:*`.

Generate your Anthropic API key at [console.anthropic.com](https://console.anthropic.com/) under API Keys.

### OIDC Bootstrap (CDK Deploy)

For repos that need to deploy to AWS, bootstrap the OIDC provider and deploy role once:

```bash
npx cdk deploy --app "npx ts-node bin/bootstrap.ts"
```

This creates an IAM OIDC Provider for `token.actions.githubusercontent.com` and an IAM Role trusted by your GitHub org/repo. Store the role ARN as `AWS_DEPLOY_ROLE_ARN` in your repo secrets.

## Examples

See [`examples/`](examples/) for ready-to-copy workflow files:

- [`ci.yml`](examples/ci.yml) — Build verification + Docker push + commitlint
- [`release.yml`](examples/release.yml) — AI-powered release on tag push
- [`ecs-express.yml`](examples/ecs-express.yml) — Tag-driven release pipeline: semver-tag → docker-ghcr → ecr-mirror → ECS Express deploy

## License

[MIT](LICENSE)
