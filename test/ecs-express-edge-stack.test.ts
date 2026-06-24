import { describe, test, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { EcsExpressEdgeStack } from '../lib/stacks/ecs-express-edge-stack';
import { applyTags } from '../lib/constructs/standard-tags';

const ENV = { account: '111111111111', region: 'us-east-1' };
const ENDPOINT = 'ho-6aa8cf0a33c84998b3e7bd4906bbf686.ecs.us-east-1.on.aws';

function makeStack(overrides: Partial<ConstructorParameters<typeof EcsExpressEdgeStack>[2]> = {}) {
  const app = new cdk.App();
  return new EcsExpressEdgeStack(app, 'TestEdge', {
    env: ENV,
    albDnsName: ENDPOINT,
    domainName: 'kota.dog',
    ...overrides,
  });
}

describe('EcsExpressEdgeStack (Cloudflare DNS, no Route53)', () => {
  test('creates a CloudFront distribution with the custom domain alias', () => {
    const template = Template.fromStack(makeStack());
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ Aliases: Match.arrayWith(['kota.dog']) }),
    });
  });

  test('NEVER creates Route53 resources', () => {
    const template = Template.fromStack(makeStack());
    template.resourceCountIs('AWS::Route53::RecordSet', 0);
    template.resourceCountIs('AWS::Route53::HostedZone', 0);
  });

  test('origin uses HTTPS_ONLY by default (the .on.aws gateway is HTTPS-only)', () => {
    const template = Template.fromStack(makeStack());
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Origins: Match.arrayWith([
          Match.objectLike({
            DomainName: ENDPOINT,
            CustomOriginConfig: Match.objectLike({ OriginProtocolPolicy: 'https-only' }),
          }),
        ]),
      }),
    });
  });

  test('caches /_next/static/* and /_next/image*', () => {
    const template = Template.fromStack(makeStack());
    const dist = Object.values(template.findResources('AWS::CloudFront::Distribution'))[0] as {
      Properties: { DistributionConfig: { CacheBehaviors?: Array<{ PathPattern: string }> } };
    };
    const patterns = (dist.Properties.DistributionConfig.CacheBehaviors ?? []).map((b) => b.PathPattern);
    expect(patterns).toContain('/_next/static/*');
    expect(patterns).toContain('/_next/image*');
  });

  test('/_next/image* forwards the query string (a custom cache policy keyed on it)', () => {
    const stack = makeStack();
    const template = Template.fromStack(stack);

    // A custom cache policy that includes the full query string in the key.
    template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({
        ParametersInCacheKeyAndForwardedToOrigin: Match.objectLike({
          QueryStringsConfig: Match.objectLike({ QueryStringBehavior: 'all' }),
        }),
      }),
    });

    // The /_next/image* behavior must NOT use the managed CACHING_OPTIMIZED
    // policy (which strips the query string and 400s the optimizer).
    const dist = Object.values(template.findResources('AWS::CloudFront::Distribution'))[0] as {
      Properties: {
        DistributionConfig: { CacheBehaviors?: Array<{ PathPattern: string; CachePolicyId: unknown }> };
      };
    };
    const CACHING_OPTIMIZED = '658327ea-f89d-4fab-a63d-7e88639e58f6';
    const imageBehavior = (dist.Properties.DistributionConfig.CacheBehaviors ?? []).find(
      (b) => b.PathPattern === '/_next/image*',
    );
    expect(imageBehavior).toBeDefined();
    expect(imageBehavior?.CachePolicyId).not.toBe(CACHING_OPTIMIZED);
  });

  test('allows all HTTP methods on the default behavior (SSR needs POST)', () => {
    const template = Template.fromStack(makeStack());
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          AllowedMethods: Match.arrayWith(['PUT', 'PATCH', 'POST', 'DELETE']),
        }),
      }),
    });
  });

  test('mints an ACM cert with DNS validation when no certificateArn', () => {
    const template = Template.fromStack(makeStack());
    template.resourceCountIs('AWS::CertificateManager::Certificate', 1);
    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'kota.dog',
      ValidationMethod: 'DNS',
    });
  });

  test('imports the cert (no new ACM resource) when certificateArn is given', () => {
    const template = Template.fromStack(
      makeStack({
        certificateArn: 'arn:aws:acm:us-east-1:111111111111:certificate/abc-123',
      }),
    );
    template.resourceCountIs('AWS::CertificateManager::Certificate', 0);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ Aliases: Match.arrayWith(['kota.dog']) }),
    });
  });

  test('additionalAliases: extra alias + a 301 redirect CloudFront function', () => {
    const template = Template.fromStack(makeStack({ additionalAliases: ['www.kota.dog'] }));
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ Aliases: Match.arrayWith(['kota.dog', 'www.kota.dog']) }),
    });
    template.resourceCountIs('AWS::CloudFront::Function', 1);
    const fn = Object.values(template.findResources('AWS::CloudFront::Function'))[0] as {
      Properties: { FunctionCode: string };
    };
    expect(fn.Properties.FunctionCode).toContain('301');
  });

  test('no redirect function without additionalAliases', () => {
    const template = Template.fromStack(makeStack());
    template.resourceCountIs('AWS::CloudFront::Function', 0);
  });

  test('default-domain mode: no cert, no aliases', () => {
    const app = new cdk.App();
    const template = Template.fromStack(
      new EcsExpressEdgeStack(app, 'NoDomain', { env: ENV, albDnsName: ENDPOINT }),
    );
    template.resourceCountIs('AWS::CertificateManager::Certificate', 0);
    template.resourceCountIs('AWS::Route53::RecordSet', 0);
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ Aliases: Match.absent() }),
    });
  });

  test('throws when albDnsName is missing', () => {
    const app = new cdk.App();
    expect(() => new EcsExpressEdgeStack(app, 'Bad', { env: ENV, albDnsName: '' })).toThrow(
      /albDnsName is required/,
    );
  });

  test('exports distribution id, domain, and site url', () => {
    const template = Template.fromStack(makeStack());
    const keys = Object.keys(template.findOutputs('*'));
    expect(keys.some((k) => k.includes('DistributionId'))).toBe(true);
    expect(keys.some((k) => k.includes('DistributionDomain'))).toBe(true);
    expect(keys.some((k) => k.includes('SiteUrl'))).toBe(true);
  });

  test('observability is opt-in: no dashboard/alarms by default', () => {
    const template = Template.fromStack(makeStack());
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 0);
    template.resourceCountIs('AWS::CloudWatch::Alarm', 0);
  });

  test('dev tier: dashboard, no alarms, no access logs', () => {
    const template = Template.fromStack(makeStack({ observability: { tier: 'dev' } }));
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
    template.resourceCountIs('AWS::CloudWatch::Alarm', 0);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ Logging: Match.absent() }),
    });
  });

  test('prod tier: dashboard + alarms + SNS + CloudFront access logs', () => {
    const template = Template.fromStack(
      makeStack({
        observability: { tier: 'prod', alarmEmail: 'ops@kota.dog' },
        loadBalancerFullName: 'app/ecs-express-gateway-alb/abc123',
        targetGroupFullName: 'targetgroup/homepage-tg/def456',
        ecsClusterName: 'default',
        ecsServiceName: 'homepage',
      }),
    );
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
    template.resourceCountIs('AWS::SNS::Topic', 1);
    template.resourceCountIs('AWS::CloudWatch::Alarm', 5);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ Logging: Match.anyValue() }),
    });
  });

  test('explicit overrides win over tier defaults (prod, alarms+logs off)', () => {
    const template = Template.fromStack(
      makeStack({
        observability: { tier: 'prod', alarms: false, accessLogs: false },
        loadBalancerFullName: 'app/ecs-express-gateway-alb/abc123',
      }),
    );
    template.resourceCountIs('AWS::CloudWatch::Alarm', 0);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ Logging: Match.absent() }),
    });
  });
});

describe('applyTags on EcsExpressEdgeStack', () => {
  test('propagates cost-allocation tags to the distribution', () => {
    const stack = makeStack();
    applyTags(stack, { Project: 'homepage', Environment: 'prod' });
    const template = Template.fromStack(stack);
    const dist = Object.values(template.findResources('AWS::CloudFront::Distribution'))[0] as {
      Properties: { Tags?: Array<{ Key: string; Value: string }> };
    };
    const tags = new Map((dist.Properties.Tags ?? []).map((t) => [t.Key, t.Value]));
    expect(tags.get('Project')).toBe('homepage');
    expect(tags.get('Environment')).toBe('prod');
  });
});
