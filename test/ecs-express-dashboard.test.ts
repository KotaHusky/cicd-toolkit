import { describe, test, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { EcsExpressDashboard } from '../lib/constructs/ecs-express-dashboard';

const ENV = { account: '111111111111', region: 'us-east-1' };

function makeDashboard(overrides: Partial<ConstructorParameters<typeof EcsExpressDashboard>[2]> = {}) {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'Host', { env: ENV });
  const distribution = new cloudfront.Distribution(stack, 'Dist', {
    defaultBehavior: { origin: new origins.HttpOrigin('alb.example.com') },
  });
  new EcsExpressDashboard(stack, 'Metrics', {
    distribution,
    serviceName: 'homepage',
    ...overrides,
  });
  return Template.fromStack(stack);
}

describe('EcsExpressDashboard', () => {
  test('always creates one dashboard with CloudFront metrics', () => {
    const template = makeDashboard();
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
    const body = JSON.stringify(template.toJSON());
    expect(body).toContain('AWS/CloudFront');
    expect(body).toContain('CacheHitRate');
    expect(body).toContain('OriginLatency');
  });

  test('omits ALB and ECS sections when identifiers are absent', () => {
    const body = JSON.stringify(makeDashboard().toJSON());
    expect(body).not.toContain('AWS/ApplicationELB');
    expect(body).not.toContain('AWS/ECS');
  });

  test('adds ALB widgets when loadBalancerFullName is supplied', () => {
    const body = JSON.stringify(
      makeDashboard({ loadBalancerFullName: 'app/homepage-alb/abc123' }).toJSON(),
    );
    expect(body).toContain('AWS/ApplicationELB');
    expect(body).toContain('TargetResponseTime');
    expect(body).toContain('HTTPCode_Target_5XX_Count');
  });

  test('adds host-health widget only when targetGroupFullName is supplied', () => {
    const without = JSON.stringify(
      makeDashboard({ loadBalancerFullName: 'app/homepage-alb/abc123' }).toJSON(),
    );
    expect(without).not.toContain('HealthyHostCount');
    const withTg = JSON.stringify(
      makeDashboard({
        loadBalancerFullName: 'app/homepage-alb/abc123',
        targetGroupFullName: 'targetgroup/homepage-tg/def456',
      }).toJSON(),
    );
    expect(withTg).toContain('HealthyHostCount');
  });

  test('adds ECS compute widgets when cluster + service are supplied', () => {
    const body = JSON.stringify(
      makeDashboard({ ecsClusterName: 'homepage-cluster', ecsServiceName: 'homepage' }).toJSON(),
    );
    expect(body).toContain('AWS/ECS');
    expect(body).toContain('CPUUtilization');
    expect(body).toContain('MemoryUtilization');
  });

  test('uses serviceName for the dashboard name by default', () => {
    const template = makeDashboard();
    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'homepage-ecs-express',
    });
  });
});
