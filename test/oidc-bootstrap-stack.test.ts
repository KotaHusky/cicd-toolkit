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
        directDeployResourceOps: true,
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

  test('every role gets account-scoped cloudformation:ListStacks', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const rolesWithListStacks = Object.values(policies).filter(p =>
      JSON.stringify(p.Properties.PolicyDocument.Statement).includes('cloudformation:ListStacks'),
    );
    expect(rolesWithListStacks.length).toBe(2);
    for (const policy of rolesWithListStacks) {
      const stmt = policy.Properties.PolicyDocument.Statement.find(
        (s: { Action: string | string[] }) => s.Action === 'cloudformation:ListStacks',
      );
      expect(stmt.Resource).toBe('*');
    }
  });

  test('directDeployResourceOps grants Cloud Control resource ops only where opted in', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const withDirectOps = Object.values(policies).filter(p =>
      JSON.stringify(p.Properties.PolicyDocument.Statement).includes('CdkDirectDeployResourceOps'),
    );
    expect(withDirectOps.length).toBe(1);
    const stmt = withDirectOps[0].Properties.PolicyDocument.Statement.find(
      (s: { Sid?: string }) => s.Sid === 'CdkDirectDeployResourceOps',
    );
    expect(stmt.Action).toEqual([
      'cloudformation:CreateResource',
      'cloudformation:UpdateResource',
      'cloudformation:DeleteResource',
      'cloudformation:GetResource',
      'cloudformation:ListResources',
    ]);
    // Cloud Control actions support no resource-level permissions — an
    // ARN-scoped grant here would silently match nothing.
    expect(stmt.Resource).toBe('*');
  });

  test('outputs role ARNs', () => {
    const outputs = template.findOutputs('*');
    const outputKeys = Object.keys(outputs);
    expect(outputKeys.some(k => k.includes('RepoADeployRole'))).toBe(true);
    expect(outputKeys.some(k => k.includes('RepoBDeployRole'))).toBe(true);
  });
});
