# cicd-toolkit

Reusable CI/CD workflows and infrastructure patterns.

## Quickstart

Bootstrap Azure Container Apps + Cloudflare DNS + GitHub secrets in one shot:

```bash
git clone https://github.com/KotaHusky/cicd-toolkit.git
cd cicd-toolkit
./bin/setup
```

**Prerequisites:** `az` (logged in), `gh` (logged in), `jq`, `curl`. Optional: `gum` for a nicer TUI.

The wizard will:
1. Create an Azure resource group + Container Apps environment via Bicep (`infra/main.bicep`)
2. Set up a managed identity with OIDC federated credentials for your GitHub repos
3. Connect your Cloudflare domain and create DNS records
4. Set all required secrets (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`) on your repos via `gh secret set`

Then add the reusable workflows to your repo's CI — see [ACA Deploy](#aca-deploy) and [Cloudflare DNS](#cloudflare-dns) below.

## Reusable Workflows

### ACA Deploy

Deploys a container image to Azure Container Apps via OIDC federated credentials.

```yaml
jobs:
  deploy:
    uses: KotaHusky/cicd-toolkit/.github/workflows/aca-deploy.yml@main
    with:
      resource-group: 'rg-homepage'
      container-app-name: 'homepage'
      image: 'ghcr.io/kotahusky/homepage:latest'
      target-port: 3000                    # optional, default: 3000
      ingress: 'external'                  # optional, default: external
      location: 'eastus'                   # optional, default: eastus
      container-app-environment: 'aca-env' # optional
    secrets:
      AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
      AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
      AZURE_SUBSCRIPTION_ID: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
    permissions:
      id-token: write
      contents: read
```

**Outputs:** `fqdn` — the deployed app's FQDN (useful for chaining to Cloudflare DNS).

### Cloudflare DNS

Creates or updates a Cloudflare DNS record and optionally purges the zone cache.

```yaml
jobs:
  dns:
    needs: deploy
    uses: KotaHusky/cicd-toolkit/.github/workflows/cloudflare-dns.yml@main
    with:
      record-name: 'app.example.com'
      record-content: ${{ needs.deploy.outputs.fqdn }}
      record-type: 'CNAME'    # optional, default: CNAME
      proxied: true            # optional, default: true
      purge-cache: true        # optional, default: false
    secrets:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ZONE_ID: ${{ secrets.CLOUDFLARE_ZONE_ID }}
```

### Docker Build & Push to GHCR

Builds a Docker image and pushes to GitHub Container Registry with SHA, branch, and latest tags. Optionally adds semver tags.

```yaml
jobs:
  docker:
    uses: KotaHusky/cicd-toolkit/.github/workflows/docker-ghcr.yml@main
    with:
      push: true
      version: '1.2.3'  # optional — adds v1.2.3, v1.2, v1 tags
    permissions:
      contents: read
      packages: write
```

### Build Verify

Runs Node.js build, test, and lint checks.

```yaml
jobs:
  verify:
    uses: KotaHusky/cicd-toolkit/.github/workflows/build-verify.yml@main
    with:
      node-version: '24'
```

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
