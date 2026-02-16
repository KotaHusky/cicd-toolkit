#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { OidcBootstrapStack } from '../lib/stacks/oidc-bootstrap-stack';

const app = new cdk.App();

new OidcBootstrapStack(app, 'OidcBootstrapStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  githubOrg: 'KotaHusky',
  roles: [
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
    // Add more repos here:
    // {
    //   repo: 'another-project',
    //   roleName: 'AnotherProjectDeployRole',
    //   policies: [...],
    // },
  ],
});
