import * as iam from 'aws-cdk-lib/aws-iam';
import type { RepoRole } from '../lib/stacks/oidc-bootstrap-stack';

/**
 * Example per-repo deploy-role config for `bin/bootstrap.ts`.
 *
 * PLACEHOLDER ONLY — do NOT deploy this file. It defines a real, broadly
 * privileged `MyAppDeployRole`; deploying it would create that role in your
 * account. Copy this file to `bin/bootstrap.roles.ts` (gitignored) and replace
 * the placeholders with your own repo(s), role name(s), and least-privilege
 * policy statements. Keep real app names and ARNs in that LOCAL file only —
 * never commit them to this shared toolkit.
 */
export const roles: RepoRole[] = [
  {
    repo: 'my-app',
    roleName: 'MyAppDeployRole',
    // branch: '*', // any ref may assume the role; omit to trust `main` only
    // directDeployResourceOps: true, // if you `cdk deploy --method=direct`
    policies: [
      new iam.PolicyStatement({
        actions: ['cloudformation:*'],
        resources: [
          'arn:aws:cloudformation:*:*:stack/MyApp-*/*',
          'arn:aws:cloudformation:*:*:stack/cdk-*/*',
        ],
      }),
      new iam.PolicyStatement({
        actions: ['s3:*'],
        resources: [
          'arn:aws:s3:::myapp-*', 'arn:aws:s3:::myapp-*/*',
          'arn:aws:s3:::cdk-*', 'arn:aws:s3:::cdk-*/*',
        ],
      }),
      new iam.PolicyStatement({
        actions: ['lambda:*'],
        resources: ['arn:aws:lambda:*:*:function:MyApp-*'],
      }),
      // Container-image Lambdas pull from ECR — the role creates the repo on the
      // first deploy in a fresh account, then pushes layers/images.
      new iam.PolicyStatement({
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      }),
      new iam.PolicyStatement({
        actions: [
          'ecr:CreateRepository', 'ecr:DescribeRepositories', 'ecr:PutLifecyclePolicy',
          'ecr:BatchCheckLayerAvailability', 'ecr:InitiateLayerUpload', 'ecr:UploadLayerPart',
          'ecr:CompleteLayerUpload', 'ecr:PutImage', 'ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer',
        ],
        resources: ['arn:aws:ecr:*:*:repository/myapp-*'],
      }),
      new iam.PolicyStatement({
        actions: [
          'iam:CreateRole', 'iam:DeleteRole', 'iam:GetRole', 'iam:PassRole',
          'iam:AttachRolePolicy', 'iam:DetachRolePolicy', 'iam:PutRolePolicy',
          'iam:DeleteRolePolicy', 'iam:GetRolePolicy', 'iam:TagRole', 'iam:UntagRole',
        ],
        resources: ['arn:aws:iam::*:role/MyApp-*', 'arn:aws:iam::*:role/cdk-*'],
      }),
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:PutParameter', 'ssm:DeleteParameter'],
        resources: ['arn:aws:ssm:*:*:parameter/MyApp/*'],
      }),
      new iam.PolicyStatement({
        actions: ['cloudwatch:*', 'logs:*'],
        resources: ['*'],
      }),
    ],
  },
];
