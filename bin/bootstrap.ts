#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { OidcBootstrapStack } from '../lib/stacks/oidc-bootstrap-stack';

const app = new cdk.App();

// Every repo's deploy role, defined once. Use `-c repos=<a,b>` to select which
// roles to create in the CURRENT target account (CDK_DEFAULT_ACCOUNT); omit to
// create all. Scoping matters now that workloads live in separate accounts: a
// bootstrap run should not mint a repo's deploy role in an account that repo
// never deploys to.
const allRoles = [
  {
    repo: 'telegram-bot',
    roleName: 'TelegramBotDeployRole',
    policies: [
      new iam.PolicyStatement({
        actions: ['cloudformation:*'],
        resources: ['*'],
      }),
      new iam.PolicyStatement({
        actions: ['s3:*'],
        resources: ['arn:aws:s3:::cdk-*', 'arn:aws:s3:::cdk-*/*'],
      }),
      new iam.PolicyStatement({
        actions: ['lambda:*'],
        resources: ['*'],
      }),
      new iam.PolicyStatement({
        actions: ['apigateway:*'],
        resources: ['*'],
      }),
      new iam.PolicyStatement({
        actions: ['dynamodb:*'],
        resources: ['*'],
      }),
      new iam.PolicyStatement({
        actions: [
          'iam:CreateRole', 'iam:DeleteRole', 'iam:GetRole', 'iam:PassRole',
          'iam:AttachRolePolicy', 'iam:DetachRolePolicy',
          'iam:PutRolePolicy', 'iam:DeleteRolePolicy', 'iam:GetRolePolicy',
          'iam:TagRole', 'iam:UntagRole',
        ],
        resources: [
          'arn:aws:iam::*:role/TelegramBot-*',
          'arn:aws:iam::*:role/cdk-*',
        ],
      }),
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:PutParameter', 'ssm:DeleteParameter'],
        resources: ['*'],
      }),
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
        resources: ['*'],
      }),
      new iam.PolicyStatement({
        actions: ['cloudwatch:*', 'logs:*'],
        resources: ['*'],
      }),
      new iam.PolicyStatement({
        actions: ['ecr:*'],
        resources: ['*'],
      }),
    ],
  },
  {
    repo: 'kinky-connections-app',
    branch: '*',
    roleName: 'KinkyConnections-GitHubDeploy',
    // Modern-bootstrap deploy: standard `cdk deploy` assumes the bootstrap
    // `cdk-*` roles (deploy / file-publishing / image-publishing / lookup),
    // which hold the actual resource-mutation permissions (the CloudFormation
    // execution role runs with AdministratorAccess). So the GitHub role needs
    // only to ASSUME those roles, plus the few direct AWS calls the CI workflow
    // makes outside CloudFormation (stack-status reads, SSM param reads, and the
    // post-deploy CloudFront invalidation). This is a much smaller trust surface
    // than the previous `--method=direct` policy (which required enumerating
    // every service the app provisions).
    policies: [
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        actions: ['sts:AssumeRole'],
        resources: ['arn:aws:iam::*:role/cdk-*'],
      }),
      new iam.PolicyStatement({
        sid: 'CdkStackStatusReads',
        // ListStacks is account-scoped (no resource-level perms); DescribeStacks
        // is used for deploy status + reading outputs.
        actions: ['cloudformation:DescribeStacks', 'cloudformation:ListStacks'],
        resources: ['*'],
      }),
      new iam.PolicyStatement({
        sid: 'PostDeployReadsAndInvalidation',
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          'arn:aws:ssm:*:*:parameter/KinkyConnections/*',
          'arn:aws:ssm:*:*:parameter/KinkyConnectionsDev/*',
          'arn:aws:ssm:*:*:parameter/kinky-connections/*',
        ],
      }),
      new iam.PolicyStatement({
        sid: 'CloudFrontInvalidation',
        actions: ['cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation'],
        resources: ['arn:aws:cloudfront::*:distribution/*'],
      }),
    ],
  },
];

const reposCtx = app.node.tryGetContext('repos');
const selectedRepos = reposCtx
  ? String(reposCtx).split(',').map((r) => r.trim()).filter(Boolean)
  : null;
const roles = selectedRepos
  ? allRoles.filter((r) => selectedRepos.includes(r.repo))
  : allRoles;

if (roles.length === 0) {
  throw new Error(
    `No roles matched -c repos=${reposCtx}. Known repos: ${allRoles.map((r) => r.repo).join(', ')}`,
  );
}

new OidcBootstrapStack(app, 'OidcBootstrapStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  githubOrg: 'KotaHusky',
  roles,
});
