# CLAUDE.md

## What This Repo Is
Reusable GitHub Actions workflows (`.github/workflows/`, all `workflow_call`),
composite actions (`actions/*/action.yml`), and AWS CDK constructs/stacks (`lib/`)
consumed by other repos. `examples/` holds copy-paste caller workflows for consumers.

## Working on Workflows & Actions
- Workflows cannot be run locally. Consumers reference this repo at `@main`, so
  merging to `main` ships to all consumers immediately. Test from a consumer repo
  pointed at your branch: `uses: KotaHusky/cicd-toolkit/.github/workflows/<wf>.yml@<branch>`.
- Shell steps run under `set -euo pipefail` — commands that legitimately exit
  non-zero (e.g. `grep` with no match) need explicit guards.
- When changing a workflow's or action's inputs/outputs, update its README section
  and the matching file in `examples/`.

## CDK Library & Releases
- No barrel `lib/index.ts` — consumers deep-import from `lib/constructs/*` and
  `lib/stacks/*`. Don't add one.
- No lockfile is committed, by design — don't add `package-lock.json`.
- Pushing a `v*` tag triggers `release.yml`, which calls the Anthropic API
  (`ANTHROPIC_API_KEY` secret) to generate release notes. Only tag when cutting a release.

## Git Worktree Rules (MANDATORY)
- **NEVER work directly on `main`**. Always create a feature branch.
- **Use git worktrees** for parallel work: `git worktree add ../<repo>-<feature> -b feat/<feature>`
- Each agent/task gets its own worktree. No two agents share a worktree.
- Clean up worktrees when done: `git worktree remove ../<repo>-<feature>`
- All branches must be prefixed: `feat/`, `fix/`, `chore/`, `docs/`

## Guardrails
- **NEVER** run: `rm -rf`, `git push --force`, `git reset --hard`, `DROP TABLE`
- **ALWAYS** run tests before committing
- **NEVER** commit `.env`, secrets, or credentials
- Keep commits **focused and atomic** — one logical change per commit. Split unrelated changes into separate commits.
- Auto-approve: read-only operations, running tests, linting

## Multi-Agent Coordination
- Each agent works in its own git worktree (see worktree rules above)
- Agents must not modify files another agent is working on
- Before starting, check `git worktree list` for conflicts
- Use conventional commit messages, scoped to the workflow/action/construct touched (e.g. `fix(static-s3-deploy): ...`)
- After completing work, create a PR — do not merge directly
