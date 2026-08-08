#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { OidcBootstrapStack, type RepoRole } from '../lib/stacks/oidc-bootstrap-stack';

/**
 * Per-repo deploy-role definitions live in a LOCAL, gitignored
 * `bin/bootstrap.roles.ts` so this shared toolkit stays repo-agnostic — no
 * consumer app names or ARNs in tracked source. Copy
 * `bin/bootstrap.roles.example.ts` → `bin/bootstrap.roles.ts` and edit it.
 *
 * If the local file is missing we THROW — we never fall back to the example.
 * The documented invocation is `cdk deploy`, so silently synthesizing the
 * placeholder would DELETE every real deploy role from the live stack. Type
 * errors in the local file surface for the same reason. `tsc`/tests never call
 * this (they type-check the file and test the construct directly), so CI is
 * unaffected by the local file's absence.
 */
function loadRoles(): RepoRole[] {
  try {
    return (require('./bootstrap.roles') as { roles: RepoRole[] }).roles;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Cannot find module '\.\/bootstrap\.roles'/.test(msg)) {
      throw new Error(
        "bin/bootstrap.roles.ts not found — copy bin/bootstrap.roles.example.ts to " +
          "bin/bootstrap.roles.ts and define your per-repo deploy roles before deploying " +
          "(it's gitignored to keep app identities out of this shared toolkit).",
      );
    }
    throw err; // real error (type error / missing dep) — never deploy the placeholder
  }
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
