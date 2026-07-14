---
name: integrate-cicd-toolkit
description: Integrate KotaHusky/cicd-toolkit reusable workflows and composite actions into the current repo — pick the right workflow, wire up the caller file, and set required secrets securely. Use when adding CI/CD (build verification, commitlint, Docker/GHCR, CDK deploys, static-site S3/CloudFront deploys, ECS Express deploys, AI-generated releases) to a repo that consumes cicd-toolkit.
---

# Integrate cicd-toolkit

You are wiring the current repo up to reusable workflows from `KotaHusky/cicd-toolkit`.

## Step 1: Fetch the current docs — do not rely on memorized inputs

Workflow inputs/outputs change; the toolkit README is the source of truth. Fetch it fresh:

```
https://raw.githubusercontent.com/KotaHusky/cicd-toolkit/main/README.md
```

For a ready-to-copy caller file, list `examples/` in the repo and fetch the one matching the chosen workflow:

```
https://api.github.com/repos/KotaHusky/cicd-toolkit/contents/examples
```

Adapt the example rather than authoring a caller from scratch.

## Step 2: Pick the workflow

| Consumer need | Workflow |
|---|---|
| PR build/test/lint for Node (Turborepo-aware) | `build-verify.yml` |
| Enforce Conventional Commits on PRs | `commitlint.yml` |
| Build + push Docker image to GHCR | `docker-ghcr.yml` |
| Deploy AWS CDK app (OIDC auth) | `cdk-deploy.yml` (synth-only check: `cdk-synth.yml`) |
| Static site (Next.js/Astro/Vite) → S3 + CloudFront | `static-s3-deploy.yml` |
| Node/Express app → ECS Fargate | `ecs-express-deploy.yml` / `ecs-express-app-deploy.yml` |
| GitHub Release with AI-generated notes on `v*` tag | `release.yml` |
| Claude AI review on every PR (inline + sticky summary) | `claude-review.yml` — needs the [Claude GitHub App](https://github.com/apps/claude) installed and `ANTHROPIC_API_KEY` **or** `CLAUDE_CODE_OAUTH_TOKEN`; advisory by default (never blocks CI), `strict: true` to enforce |
| Semver tag automation | `semver-tag.yml` |
| Azure Container Apps | `aca-provision.yml`, `aca-deploy.yml` |
| Cloudflare DNS management | `cloudflare-dns.yml` |

Reference pattern (all are `workflow_call`):

```yaml
jobs:
  ci:
    uses: KotaHusky/cicd-toolkit/.github/workflows/<workflow>.yml@main
    with: ...
    secrets: ...
```

Composite actions (`turbo-setup`, `ecr-mirror`, `cfn-recover`) are referenced as
`uses: KotaHusky/cicd-toolkit/actions/<action>@main` inside a consumer's own job steps.

## Step 3: Secrets — never let a secret enter the conversation

Determine which secrets the chosen workflow needs (from the fetched README). Common ones:

- `AWS_DEPLOY_ROLE_ARN` — for any AWS deploy workflow; produced by the OIDC bootstrap (see the `bootstrap-oidc` skill). No static AWS keys, ever.
- `ANTHROPIC_API_KEY` — for `release.yml` AI release notes.
- `TURBO_TOKEN` / `TURBO_TEAM` — optional, Turbo remote cache.
- `NODE_AUTH_TOKEN` — optional, private GitHub Packages during builds.

**Handoff procedure (mandatory):** secret handling happens entirely **outside the Claude session** — never ask the user to paste a secret into chat, never compose a command containing one, and don't run the storage command yourself (not even via the `!` prefix; keeping the whole flow out of the session guarantees no secret can enter the conversation). Have the user copy the value (from the Anthropic Console, AWS output, etc.) and run this **in their own terminal**:

```sh
# user's own terminal — not inside the Claude session
pbpaste | gh secret set <SECRET_NAME> -R <owner>/<repo>
```

The value flows clipboard → gh → GitHub's encrypted store without ever being displayed or entering shell history. On Linux replace `pbpaste` with `xclip -selection clipboard -o` or `wl-paste`.

For Claude/Anthropic tokens specifically, follow the flows in the next section.

## Claude token setup (reviewer / release workflows)

Two token types, two flows. Both run **entirely in the user's own terminal, outside
the Claude session** (per the handoff procedure above; `claude setup-token` is also
interactive — browser auth — and won't run under a session shell). Ask which the user
wants if unclear: OAuth token uses a Claude Pro/Max subscription; API key bills per-token.

**`CLAUDE_CODE_OAUTH_TOKEN`** — used by `anthropics/claude-code-action` workflows
(e.g. cicd-toolkit's own `claude-review.yml`). This one *can* be generated locally.
Give the user these steps to run in their own terminal:

```sh
# user's own terminal — not inside the Claude session
claude setup-token   # browser auth; prints a long-lived OAuth token (Pro/Max required)
# copy the printed token, then:
pbpaste | gh secret set CLAUDE_CODE_OAUTH_TOKEN -R <owner>/<repo>
```

**`ANTHROPIC_API_KEY`** — used by `release.yml` for AI release notes. API keys
**cannot** be created programmatically (the Admin API only lists/renames/disables
existing keys). The user creates a key at https://console.anthropic.com/settings/keys,
copies it, then in their own terminal:

```sh
# user's own terminal — not inside the Claude session
pbpaste | gh secret set ANTHROPIC_API_KEY -R <owner>/<repo>
```

Verify either with `gh secret list -R <owner>/<repo>` — names and timestamps only;
values are never readable back, which is the point.

## Gotchas

- Consumers pin `@main` — toolkit changes ship to this repo immediately on merge upstream. Pin a tag or SHA if the consumer needs stability.
- Grant each caller job the `permissions:` block shown in the toolkit README for that workflow (OIDC deploys need `id-token: write`).
- `release.yml` and `commitlint.yml` assume Conventional Commit messages.
- Verify by opening a small PR (or pushing a tag for release flows) and watching the run — reusable workflows can't be executed locally.
