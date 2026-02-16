import { describe, test, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Template } from 'aws-cdk-lib/assertions';
import { OidcBootstrapStack } from '../lib/stacks/oidc-bootstrap-stack';

describe('OidcBootstrapStack', () => {
  const app = new cdk.App();
  const stack = new OidcBootstrapStack(app, 'TestBootstrap', {
    githubOrg: 'TestOrg',
    roles: [
      {
        repo: 'repo-a',
        roleName: 'RepoADeployRole',
        policies: [
          new iam.PolicyStatement({
            actions: ['s3:GetObject'],
            resources: ['*'],
          }),
        ],
      },
      {
        repo: 'repo-b',
        roleName: 'RepoBDeployRole',
        branch: 'develop',
        policies: [
          new iam.PolicyStatement({
            actions: ['lambda:InvokeFunction'],
            resources: ['*'],
          }),
        ],
      },
    ],
  });
  const template = Template.fromStack(stack);

  test('creates a single OIDC provider', () => {
    template.resourceCountIs('Custom::AWSCDKOpenIdConnectProvider', 1);
  });

  test('creates a deploy role per repo (+ 1 CDK custom resource role)', () => {
    // 2 deploy roles + 1 Lambda execution role for the OIDC provider custom resource
    template.resourceCountIs('AWS::IAM::Role', 3);
  });

  test('creates role with correct name for repo-a', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'RepoADeployRole',
    });
  });

  test('creates role with correct name for repo-b', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'RepoBDeployRole',
    });
  });

  test('outputs role ARNs', () => {
    const outputs = template.findOutputs('*');
    const outputKeys = Object.keys(outputs);
    expect(outputKeys.some(k => k.includes('RepoADeployRole'))).toBe(true);
    expect(outputKeys.some(k => k.includes('RepoBDeployRole'))).toBe(true);
  });
});
