# CLAUDE.md

## What This Repo Is
Reusable GitHub Actions workflows (`.github/workflows/`, all `workflow_call`),
composite actions (`actions/*/action.yml`), and AWS CDK constructs/stacks (`lib/`)
consumed by other repos. `examples/` holds copy-paste caller workflows for consumers.

## Working on Workflows & Actions
- Workflows cannot be run locally. Consumers reference this repo at `@main`, so
  merging to `main` ships to all consumers immediately. Test from a consumer repo
  pointed at your branch: `uses: KotaHusky/cicd-toolkit/.github/workflows/<wf>.yml@<branch>`.
- Third-party actions are pinned to commit SHAs with a `# <tag>` comment
  (Dependabot keeps them fresh). Keep new `uses:` refs SHA-pinned, except
  `actions/*` and `anthropics/*` which stay on tags.
- Shell steps run under `set -euo pipefail` — commands that legitimately exit
  non-zero (e.g. `grep` with no match) need explicit guards.
- When changing a workflow's or action's inputs/outputs, update its README section
  and the matching file in `examples/`.

## CDK Library & Releases
- No barrel `lib/index.ts` — consumers deep-import from `lib/constructs/*` and
  `lib/stacks/*`. Don't add one.
- Pushing a `v*` tag triggers `release.yml`, which calls the Anthropic API
  (`ANTHROPIC_API_KEY` secret) to generate release notes. Only tag when cutting a release.

## Claude Tooling in This Repo
- This repo hosts a Claude Code plugin marketplace (`.claude-plugin/marketplace.json`
  + `plugins/cicd-toolkit/skills/`). When a workflow's inputs, secrets, or the
  integration flow change, check the plugin skills for drift too — they're the
  guidance consumer repos' agents receive. Bump the version in
  `plugins/cicd-toolkit/.claude-plugin/plugin.json` whenever skills change.
- `claude-review.yml` is a **reusable** (`workflow_call`) Claude review workflow
  consumers call like any other; `claude-review-self.yml` dogfoods it on this repo's
  own PRs (inline + sticky comments; skips bot PRs; needs the `CLAUDE_CODE_OAUTH_TOKEN`
  or `ANTHROPIC_API_KEY` secret). Changing its inputs is a consumer-facing change.
- Releases are two-tier: engineer notes (release body) plus a public
  `whats-new.json` generated from the consumer's `.github/whats-new-context.md`,
  sanitized by a judge pass and a deny-list. The context file is a living doc —
  the integrate skill mandates updating it alongside feature changes.
- Secrets never touch a Claude session — not pasted into chat, not composed into
  commands, not run via the `!` prefix. The user runs
  `pbpaste | gh secret set <NAME> -R KotaHusky/cicd-toolkit` in their own terminal.

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
- Before merging any PR, disposition every review thread: push a fix, or
  resolve it with a reply stating why it's dismissed. Never resolve a thread
  without a reply. The "Review Threads Resolved" check enforces this.
