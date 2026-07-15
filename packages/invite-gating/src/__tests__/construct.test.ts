import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect, beforeAll } from 'vitest';
import { InviteGating } from '../construct.js';

// Stub Lambda assets during CDK assertion tests
process.env.NODE_ENV = 'test';

let template: Template;

beforeAll(() => {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
  });
  const userPool = new cognito.UserPool(stack, 'UserPool', {
    selfSignUpEnabled: true,
  });
  new InviteGating(stack, 'InviteGating', {
    userPool,
    resourcePrefix: 'test',
    appDomain: 'test.example.com',
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  });
  template = Template.fromStack(stack);
});

describe('InviteGating construct', () => {
  it('creates the invite-codes DynamoDB table with TTL', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'test-invite-codes',
      BillingMode: 'PAY_PER_REQUEST',
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    });
  });

  it('creates the pre-signup Lambda with correct runtime and env', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'test-invite-presignup',
      Runtime: 'nodejs20.x',
      Architectures: ['arm64'],
      Handler: 'handler.handler',
      Environment: {
        Variables: { RESOURCE_PREFIX: 'test' },
      },
    });
  });

  it('creates the admin Lambda with all env vars', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'test-invite-admin',
      Runtime: 'nodejs20.x',
      Architectures: ['arm64'],
      Environment: {
        Variables: {
          RESOURCE_PREFIX: 'test',
          APP_DOMAIN: 'test.example.com',
          CODE_EXPIRY_DAYS: '30',
        },
      },
    });
  });

  it('creates the SSM Automation document', () => {
    template.hasResourceProperties('AWS::SSM::Document', {
      Name: 'test-invite-admin-runbook',
      DocumentType: 'Automation',
    });
  });

  it('creates the admin managed policy', () => {
    template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      ManagedPolicyName: 'test-invite-admin-invoke-policy',
    });
  });

  it('creates the automation execution role scoped to SSM', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'test-invite-admin-automation-role',
      AssumeRolePolicyDocument: {
        Statement: [
          { Action: 'sts:AssumeRole', Principal: { Service: 'ssm.amazonaws.com' } },
        ],
      },
    });
  });
});
