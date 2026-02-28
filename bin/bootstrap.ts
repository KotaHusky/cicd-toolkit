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
    {
      repo: 'kinky-connections-app',
      branch: '*',
      roleName: 'KinkyConnections-GitHubDeploy',
      policies: [
        new iam.PolicyStatement({
          actions: ['cloudformation:*'],
          resources: [
            'arn:aws:cloudformation:*:*:stack/KinkyConnections-*/*',
            'arn:aws:cloudformation:*:*:stack/KinkyConnectionsDev-*/*',
            'arn:aws:cloudformation:*:*:stack/cdk-*/*',
          ],
        }),
        new iam.PolicyStatement({
          actions: ['s3:*'],
          resources: [
            'arn:aws:s3:::kinkyconnections-*', 'arn:aws:s3:::kinkyconnections-*/*',
            'arn:aws:s3:::cdk-*', 'arn:aws:s3:::cdk-*/*',
          ],
        }),
        new iam.PolicyStatement({
          actions: ['dynamodb:*'],
          resources: [
            'arn:aws:dynamodb:*:*:table/KinkyConnections-*',
            'arn:aws:dynamodb:*:*:table/KinkyConnectionsDev-*',
          ],
        }),
        new iam.PolicyStatement({
          actions: ['cognito-idp:*'],
          resources: ['arn:aws:cognito-idp:*:*:userpool/*'],
        }),
        new iam.PolicyStatement({
          actions: ['lambda:*'],
          resources: [
            'arn:aws:lambda:*:*:function:KinkyConnections-*',
            'arn:aws:lambda:*:*:function:KinkyConnectionsDev-*',
            'arn:aws:lambda:*:*:function:kinky-connections-*',
          ],
        }),
        new iam.PolicyStatement({
          actions: ['apigateway:*'],
          resources: ['arn:aws:apigateway:*::/apis*', 'arn:aws:apigateway:*::/tags*'],
        }),
        new iam.PolicyStatement({
          actions: ['apprunner:*'],
          resources: [
            'arn:aws:apprunner:*:*:service/KinkyConnections-*/*',
            'arn:aws:apprunner:*:*:service/KinkyConnectionsDev-*/*',
          ],
        }),
        new iam.PolicyStatement({
          actions: ['cloudfront:*'],
          resources: ['arn:aws:cloudfront::*:distribution/*'],
        }),
        new iam.PolicyStatement({
          actions: ['cloudwatch:*', 'logs:*', 'xray:*'],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          actions: [
            'iam:CreateRole', 'iam:DeleteRole', 'iam:GetRole', 'iam:PassRole',
            'iam:AttachRolePolicy', 'iam:DetachRolePolicy',
            'iam:PutRolePolicy', 'iam:DeleteRolePolicy', 'iam:GetRolePolicy',
            'iam:TagRole', 'iam:UntagRole', 'iam:ListRolePolicies', 'iam:ListAttachedRolePolicies',
          ],
          resources: [
            'arn:aws:iam::*:role/KinkyConnections-*',
            'arn:aws:iam::*:role/KinkyConnectionsDev-*',
            'arn:aws:iam::*:role/cdk-*',
          ],
        }),
        new iam.PolicyStatement({
          actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:PutParameter', 'ssm:DeleteParameter'],
          resources: [
            'arn:aws:ssm:*:*:parameter/KinkyConnections/*',
            'arn:aws:ssm:*:*:parameter/KinkyConnectionsDev/*',
          ],
        }),
        new iam.PolicyStatement({
          actions: ['secretsmanager:*'],
          resources: [
            'arn:aws:secretsmanager:*:*:secret:KinkyConnections-*',
            'arn:aws:secretsmanager:*:*:secret:KinkyConnectionsDev-*',
          ],
        }),
        new iam.PolicyStatement({
          actions: ['sts:AssumeRole'],
          resources: ['arn:aws:iam::*:role/cdk-*'],
        }),
      ],
    },
  ],
});
