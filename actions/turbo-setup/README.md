# `turbo-setup` — Turbo Setup

Composite action that installs Node.js, restores/saves `node_modules` from cache, enables [Turbo remote cache](https://turbo.build/repo/docs/core-concepts/remote-caching), and optionally pre-builds workspace packages.

## What it does

1. `actions/setup-node@v4` with the requested version.
2. Attempts to restore `node_modules` from the Actions cache (key: `node-modules-{os}-{version}-{package-lock.json hash}`).
3. Runs `npm ci` on a cache miss, then saves the populated `node_modules`.
4. Enables Turbo remote cache via `rharkor/caching-for-turbo@v2.2.1`.
5. If `pre-build-filter` is set, runs `npx turbo run build --filter=<filter>` to pre-build shared workspace packages before the main job.

**Note:** The `node_modules` cache key is keyed on `package-lock.json`. This action is **npm-only** — it does not support pnpm.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `node-version` | no | `24` | Node.js version |
| `pre-build-filter` | no | `''` | Turbo filter for packages to build before the main task (e.g. `@my-org/shared`) |

## Usage

```yaml
- uses: KotaHusky/cicd-toolkit/actions/turbo-setup@main
  with:
    node-version: '24'
    pre-build-filter: '@my-org/shared'
```

Used automatically by `cdk-deploy.yml` and `cdk-synth.yml`.
