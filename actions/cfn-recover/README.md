# `cfn-recover` — CloudFormation Stack Recovery

Composite action that recovers CloudFormation stacks stuck in terminal states before a CDK deploy.

## What it does

1. Finds stacks in `ROLLBACK_COMPLETE` whose names start with `stack-prefix` and **deletes** them (CDK will recreate them on the next deploy).
2. Finds stacks in `UPDATE_ROLLBACK_FAILED` and calls `continue-update-rollback`, skipping the resources that caused the failure.

Assumes AWS credentials are already configured (e.g. via `aws-actions/configure-aws-credentials`).

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `stack-prefix` | yes | Stack name prefix to match (e.g. `MyProject-`) |

## Usage

```yaml
- uses: KotaHusky/cicd-toolkit/actions/cfn-recover@main
  with:
    stack-prefix: MyProject-
```

Used automatically by `cdk-deploy.yml` when `recover-stacks: true` and `stack-prefix` is set.
