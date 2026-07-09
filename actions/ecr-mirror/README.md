# `ecr-mirror` — ECR Mirror

Composite action that mirrors a container image to a private ECR repository using [crane](https://github.com/google/go-containerregistry/blob/main/cmd/crane/README.md) (registry-to-registry copy — no local pull/push).

## What it does

1. Resolves the ECR repo name (defaults to lowercased `GITHUB_REPOSITORY` base name).
2. Creates the ECR repository if it does not exist.
3. Applies a lifecycle policy to expire untagged images after `untagged-expiry-days` days.
4. Installs crane and copies the source image directly to ECR without pulling it locally.

Assumes AWS credentials are already configured (e.g. via `aws-actions/configure-aws-credentials`). For private source images, log in to the source registry before calling this action (e.g. `docker login ghcr.io`).

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `source-image` | yes | — | Full source image URI (e.g. `ghcr.io/owner/repo:tag` or `@sha256:…`) |
| `ecr-repo` | no | `${{ github.repository }}` (base name, lowercased) | ECR repository name |
| `ecr-tag` | no | `latest` | Tag to apply on the ECR image |
| `aws-region` | yes | — | AWS region for ECR |
| `untagged-expiry-days` | no | `1` | Days before untagged images are expired |

## Outputs

| Output | Description |
|--------|-------------|
| `ecr-uri` | Full ECR image URI (without tag) |
| `ecr-image` | Full ECR image URI with tag (`ecr-uri:ecr-tag`) |

## Usage

```yaml
- uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
    aws-region: us-east-1

- name: Log in to GHCR (for private source images)
  run: echo "${{ github.token }}" | docker login ghcr.io -u ${{ github.actor }} --password-stdin

- id: mirror
  uses: KotaHusky/cicd-toolkit/actions/ecr-mirror@v2
  with:
    source-image: ghcr.io/my-org/my-app@${{ needs.build.outputs.digest }}
    ecr-repo: my-app
    ecr-tag: ${{ github.sha }}
    aws-region: us-east-1

- run: echo "Image at ${{ steps.mirror.outputs.ecr-image }}"
```
