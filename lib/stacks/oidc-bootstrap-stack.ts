import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface RepoRole {
  /** GitHub repo name (e.g. 'telegram-bot') */
  repo: string;
  /** IAM role name (e.g. 'TelegramBotDeployRole') */
  roleName: string;
  /** IAM policy statements for this role */
  policies: iam.PolicyStatement[];
  /** Branch filter — defaults to 'main' */
  branch?: string;
}

export interface OidcBootstrapStackProps extends cdk.StackProps {
  /** GitHub org or user (e.g. 'KotaHusky') */
  githubOrg: string;
  /** Per-repo role definitions */
  roles: RepoRole[];
}

export class OidcBootstrapStack extends cdk.Stack {
  public readonly oidcProvider: iam.IOpenIdConnectProvider;
  public readonly deployRoles: Map<string, iam.Role> = new Map();

  constructor(scope: Construct, id: string, props: OidcBootstrapStackProps) {
    super(scope, id, props);

    this.oidcProvider = new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
      thumbprints: ['6938fd4d98bab03faadb97b34396831e3780aea1'],
    });

    for (const roleDef of props.roles) {
      const branch = roleDef.branch ?? 'main';
      const repoFilter = `repo:${props.githubOrg}/${roleDef.repo}:ref:refs/heads/${branch}`;

      const role = new iam.Role(this, `Role-${roleDef.repo}`, {
        roleName: roleDef.roleName,
        assumedBy: new iam.FederatedPrincipal(
          this.oidcProvider.openIdConnectProviderArn,
          {
            StringLike: {
              'token.actions.githubusercontent.com:sub': repoFilter,
            },
            StringEquals: {
              'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            },
          },
          'sts:AssumeRoleWithWebIdentity',
        ),
        maxSessionDuration: cdk.Duration.hours(1),
      });

      for (const policy of roleDef.policies) {
        role.addToPolicy(policy);
      }

      // Every role needs STS for CDK bootstrap assume-role
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ['sts:AssumeRole'],
          resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
        }),
      );

      this.deployRoles.set(roleDef.repo, role);

      new cdk.CfnOutput(this, `${roleDef.roleName}Arn`, {
        value: role.roleArn,
        description: `Deploy role ARN for ${roleDef.repo}`,
      });
    }
  }
}
