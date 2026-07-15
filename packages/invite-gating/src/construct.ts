import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { mkdirSync, writeFileSync } from 'fs';
import * as path from 'path';

export interface InviteGatingProps {
  userPool: cognito.UserPool;
  resourcePrefix: string;
  appDomain: string;
  removalPolicy?: cdk.RemovalPolicy;
  codeExpiryDays?: number;
}

export class InviteGating extends Construct {
  public readonly inviteCodesTable: dynamodb.Table;
  public readonly adminPolicyArn: string;

  constructor(scope: Construct, id: string, props: InviteGatingProps) {
    super(scope, id);

    const {
      userPool,
      resourcePrefix,
      appDomain,
      removalPolicy = cdk.RemovalPolicy.RETAIN,
      codeExpiryDays = 30,
    } = props;

    // ── Invite codes table ──────────────────────────────────────────────
    this.inviteCodesTable = new dynamodb.Table(this, 'Table', {
      tableName: `${resourcePrefix}-invite-codes`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy,
    });

    // ── Lambda asset helper ─────────────────────────────────────────────
    // In tests: emit a stub dir so CDK assertions don't call esbuild.
    // In production: use pre-built ZIP from assets/ (produced by `npm run build`).
    // __dirname is the CommonJS global pointing to the compiled output dir (dist/).
    // Pre-built ZIPs live at <package-root>/assets/, i.e. one level up from dist/.
    const bundleAsset = (lambdaDir: string): lambda.AssetCode => {
      if (process.env.NODE_ENV === 'test') {
        const stubDir = `/tmp/cdk-stub-${lambdaDir}`;
        mkdirSync(stubDir, { recursive: true });
        writeFileSync(path.join(stubDir, 'handler.js'), 'exports.handler = async () => {};');
        return lambda.Code.fromAsset(stubDir);
      }
      return lambda.Code.fromAsset(path.join(__dirname, '..', 'assets', `${lambdaDir}.zip`));
    };

    const logRetention = logs.RetentionDays.ONE_MONTH;

    // ── Pre-signup Lambda ───────────────────────────────────────────────
    const preSignupFn = new lambda.Function(this, 'PreSignupFn', {
      functionName: `${resourcePrefix}-invite-presignup`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'handler.handler',
      code: bundleAsset('presignup'),
      environment: { RESOURCE_PREFIX: resourcePrefix },
      timeout: cdk.Duration.seconds(10),
      logGroup: new logs.LogGroup(this, 'PreSignupLogs', {
        logGroupName: `/aws/lambda/${resourcePrefix}-invite-presignup`,
        retention: logRetention,
        removalPolicy,
      }),
    });

    this.inviteCodesTable.grantReadWriteData(preSignupFn);

    preSignupFn.addPermission('CognitoInvoke', {
      principal: new iam.ServicePrincipal('cognito-idp.amazonaws.com'),
      sourceArn: userPool.userPoolArn,
    });

    userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignupFn);

    // ── Admin Lambda ────────────────────────────────────────────────────
    const adminFn = new lambda.Function(this, 'AdminFn', {
      functionName: `${resourcePrefix}-invite-admin`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'handler.handler',
      code: bundleAsset('admin'),
      environment: {
        RESOURCE_PREFIX: resourcePrefix,
        APP_DOMAIN: appDomain,
        CODE_EXPIRY_DAYS: String(codeExpiryDays),
      },
      timeout: cdk.Duration.seconds(30),
      logGroup: new logs.LogGroup(this, 'AdminLogs', {
        logGroupName: `/aws/lambda/${resourcePrefix}-invite-admin`,
        retention: logRetention,
        removalPolicy,
      }),
    });

    this.inviteCodesTable.grantReadWriteData(adminFn);

    // ── SSM Automation execution role ───────────────────────────────────
    const automationRole = new iam.Role(this, 'AutomationRole', {
      roleName: `${resourcePrefix}-invite-admin-automation-role`,
      assumedBy: new iam.ServicePrincipal('ssm.amazonaws.com'),
    });

    adminFn.grantInvoke(automationRole);

    // ── Human admin managed policy ──────────────────────────────────────
    const adminPolicy = new iam.ManagedPolicy(this, 'AdminInvokePolicy', {
      managedPolicyName: `${resourcePrefix}-invite-admin-invoke-policy`,
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'ssm:StartAutomationExecution',
            'ssm:GetAutomationExecution',
            'ssm:ListAutomationExecutions',
          ],
          resources: [
            `arn:aws:ssm:*:*:automation-definition/${resourcePrefix}-invite-admin-runbook:*`,
          ],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['iam:PassRole'],
          resources: [automationRole.roleArn],
          conditions: {
            StringEquals: { 'iam:PassedToService': 'ssm.amazonaws.com' },
          },
        }),
      ],
    });

    this.adminPolicyArn = adminPolicy.managedPolicyArn;

    // ── SSM Automation document ─────────────────────────────────────────
    const payload = JSON.stringify({
      action: '{{ Action }}',
      label: '{{ Label }}',
      labels: '{{ Labels }}',
      code: '{{ Code }}',
    });

    new ssm.CfnDocument(this, 'AdminRunbook', {
      name: `${resourcePrefix}-invite-admin-runbook`,
      documentType: 'Automation',
      content: {
        schemaVersion: '0.3',
        description: 'Invite code management. Generate: create codes. List: view all codes. Revoke: delete unused codes.',
        assumeRole: '{{ AutomationAssumeRole }}',
        parameters: {
          AutomationAssumeRole: {
            type: 'String',
            default: automationRole.roleArn,
            description: 'IAM role for SSM Automation (do not change)',
          },
          Action: {
            type: 'String',
            allowedValues: ['Generate', 'List', 'Revoke'],
            description: 'Generate: create code(s). List: view all codes and status. Revoke: delete an unused code.',
          },
          Label: {
            type: 'String',
            default: '',
            description: '(Generate only) Label for one code, e.g. "For Alex"',
          },
          Labels: {
            type: 'String',
            default: '',
            description: '(Generate only) Comma-separated labels for bulk, e.g. "Alex, Bob". Overrides Label when set.',
          },
          Code: {
            type: 'String',
            default: '',
            description: '(Revoke only) The 8-character invite code to revoke',
          },
        },
        mainSteps: [
          {
            name: 'InvokeAdminLambda',
            action: 'aws:invokeLambdaFunction',
            inputs: {
              FunctionName: adminFn.functionName,
              Payload: payload,
            },
            outputs: [{ Name: 'Result', Selector: '$.Payload', Type: 'String' }],
          },
        ],
        outputs: ['InvokeAdminLambda.Result'],
      },
    });
  }
}
