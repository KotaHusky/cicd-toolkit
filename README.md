# cicd-toolkit

Reusable CI/CD workflows and infrastructure patterns.

## Reusable Workflows

### CDK Deploy

Reusable workflow for deploying AWS CDK applications via GitHub Actions with OIDC authentication.

**Usage in your repo's workflow:**

```yaml
jobs:
  deploy:
    uses: KotaHusky/cicd-toolkit/.github/workflows/cdk-deploy.yml@main
    with:
      aws-region: 'us-east-1'    # optional, default: us-east-1
      node-version: '24'          # optional, default: 24
      working-directory: '.'      # optional, default: .
    secrets:
      role-arn: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
```

**What it does:**
1. Checks out the repo
2. Sets up Node.js with npm caching
3. Installs dependencies (`npm ci`)
4. Configures AWS credentials via OIDC (`role-to-assume`)
5. Runs `cdk diff` to preview changes
6. Runs `cdk deploy --all --require-approval never`

## OIDC Bootstrap Pattern

For repos that need to deploy to AWS from GitHub Actions, use the OIDC bootstrap CDK stack pattern:

### How it works

1. A separate CDK entry point (`bin/bootstrap.ts`) defines an `OidcBootstrapStack` that creates:
   - An IAM OIDC Provider for `token.actions.githubusercontent.com`
   - An IAM Role (`GitHubActionsDeployRole`) trusted by your GitHub org/repo

2. The main CDK app (`bin/app.ts` via `cdk.json`) contains only app stacks.

3. CI/CD runs `cdk deploy` which uses the default `cdk.json` entry point — it never touches the bootstrap stack.

### One-time manual deploy

```bash
npx cdk deploy --app "npx ts-node bin/bootstrap.ts"
```

This creates the OIDC provider and deploy role. Store the role ARN as `AWS_DEPLOY_ROLE_ARN` in your GitHub repo secrets.

### Why separate entry points?

- **Security**: CI/CD cannot modify the OIDC provider or its own IAM permissions
- **Simplicity**: `cdk.json` points to app stacks only; bootstrap is a manual one-time operation
- **Isolation**: Bootstrap stack has its own lifecycle, independent of app deployments
