#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { OidcBootstrapStack, type RepoRole } from '../lib/stacks/oidc-bootstrap-stack';

/**
 * Per-repo deploy-role definitions live in a LOCAL, gitignored
 * `bin/bootstrap.roles.ts` so this shared toolkit stays repo-agnostic — no
 * consumer app names or ARNs in tracked source. Copy
 * `bin/bootstrap.roles.example.ts` → `bin/bootstrap.roles.ts` and edit it.
 * Falls back to the placeholder example when the local file is absent (e.g.
 * CI typecheck/synth), so the build never depends on untracked config.
 */
function loadRoles(): RepoRole[] {
  for (const mod of ['./bootstrap.roles', './bootstrap.roles.example']) {
    try {
      return (require(mod) as { roles: RepoRole[] }).roles;
    } catch {
      // not present — try the next candidate
    }
  }
  return [];
}

const app = new cdk.App();

new OidcBootstrapStack(app, 'OidcBootstrapStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  githubOrg: 'KotaHusky',
  roles: loadRoles(),
});
