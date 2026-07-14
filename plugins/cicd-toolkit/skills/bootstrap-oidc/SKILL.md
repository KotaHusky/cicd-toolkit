---
name: bootstrap-oidc
description: One-time AWS setup so a GitHub repo can deploy via cicd-toolkit's AWS workflows (cdk-deploy, static-s3-deploy, ECS) using OIDC instead of static credentials. Use when a consumer repo hits missing AWS_DEPLOY_ROLE_ARN, "not authorized to perform sts:AssumeRoleWithWebIdentity", or is adopting an AWS deploy workflow for the first time.
---

# Bootstrap GitHub → AWS OIDC

`cicd-toolkit` deploys to AWS by assuming an IAM role via GitHub's OIDC provider — no long-lived AWS keys. This bootstrap provisions, once per AWS account:

1. An IAM OIDC provider for `token.actions.githubusercontent.com`
2. An IAM role trusted by the GitHub org/repo(s), with deployment policies
3. Outputs the role ARN consumers store as the `AWS_DEPLOY_ROLE_ARN` secret

## Procedure

1. Clone (or work from) `KotaHusky/cicd-toolkit`. Read `bin/bootstrap.ts` first — the org name and per-repo role/policy configuration live there; confirm the target org/repos with the user before deploying.
2. Confirm AWS credentials for the *target account* are active locally (`aws sts get-caller-identity`). If not, the user must authenticate first (e.g. `! aws sso login`).
3. Deploy the bootstrap stack:

   ```sh
   npx cdk deploy --app "npx ts-node bin/bootstrap.ts"
   ```

4. Capture the role ARN from the stack outputs.
5. Store it in the consumer repo **without pasting it into chat** — have the user copy the ARN and run:

   ```
   ! pbpaste | gh secret set AWS_DEPLOY_ROLE_ARN -R <owner>/<repo>
   ```

   (Role ARNs are only mildly sensitive, but use the same pipe habit as for real secrets.)

6. Verify: trigger the consumer's deploy workflow and confirm the `Configure AWS credentials` step assumes the role successfully.

## Gotchas

- One OIDC provider per AWS account — if `token.actions.githubusercontent.com` already exists, the stack must import/reuse it rather than create a duplicate.
- The role's trust policy scopes which repos/branches may assume it. A new consumer repo usually means editing `bin/bootstrap.ts` and re-deploying, not creating a new provider.
- CDK deploys additionally require the account to be CDK-bootstrapped (`npx cdk bootstrap`) in the target region.
