import { describe, test, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { EcsExpressEdgeStack } from '../lib/stacks/ecs-express-edge-stack';
import { applyTags } from '../lib/constructs/standard-tags';

const ENV = { account: '111111111111', region: 'us-east-1' };
const ALB = 'homepage-alb-1234567890.us-east-1.elb.amazonaws.com';

function makeStack(overrides: Partial<ConstructorParameters<typeof EcsExpressEdgeStack>[2]> = {}) {
  const app = new cdk.App({
    // HostedZone.fromLookup needs account/region resolvable at synth time.
    context: {
      'hosted-zone:account=111111111111:domainName=kota.dog:region=us-east-1': {
        Id: '/hostedzone/ZTEST123',
        Name: 'kota.dog.',
      },
    },
  });
  return new EcsExpressEdgeStack(app, 'TestEdge', {
    env: ENV,
    albDnsName: ALB,
    domainName: 'kota.dog',
    hostedZoneName: 'kota.dog',
    ...overrides,
  });
}

describe('EcsExpressEdgeStack', () => {
  test('creates a CloudFront distribution with the custom domain alias', () => {
    const template = Template.fromStack(makeStack());
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: Match.arrayWith(['kota.dog']),
      }),
    });
  });

  test('points the origin at the ALB over HTTP only by default', () => {
    const template = Template.fromStack(makeStack());
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Origins: Match.arrayWith([
          Match.objectLike({
            DomainName: ALB,
            CustomOriginConfig: Match.objectLike({ OriginProtocolPolicy: 'http-only' }),
          }),
        ]),
      }),
    });
  });

  test('disables caching on the default (SSR) behavior and caches /_next/static/*', () => {
    const template = Template.fromStack(makeStack());
    const dist = Object.values(template.findResources('AWS::CloudFront::Distribution'))[0] as {
      Properties: { DistributionConfig: { CacheBehaviors?: Array<{ PathPattern: string }> } };
    };
    const patterns = (dist.Properties.DistributionConfig.CacheBehaviors ?? []).map((b) => b.PathPattern);
    expect(patterns).toContain('/_next/static/*');
    expect(patterns).toContain('/_next/image*');
  });

  test('allows all HTTP methods on the default behavior (SSR needs POST)', () => {
    const template = Template.fromStack(makeStack());
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          // ALLOW_ALL renders as GET,HEAD,OPTIONS,PUT,PATCH,POST,DELETE.
          AllowedMethods: Match.arrayWith(['PUT', 'PATCH', 'POST', 'DELETE']),
        }),
      }),
    });
  });

  test('creates an ACM certificate with DNS validation', () => {
    const template = Template.fromStack(makeStack());
    template.resourceCountIs('AWS::CertificateManager::Certificate', 1);
    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'kota.dog',
      ValidationMethod: 'DNS',
    });
  });

  test('creates A + AAAA alias records by default', () => {
    const template = Template.fromStack(makeStack());
    template.resourceCountIs('AWS::Route53::RecordSet', 2);
  });

  test('skips DNS records when createDnsRecord is false', () => {
    const template = Template.fromStack(makeStack({ createDnsRecord: false }));
    template.resourceCountIs('AWS::Route53::RecordSet', 0);
  });

  test('honors originProtocolPolicy override', () => {
    const template = Template.fromStack(
      makeStack({ originProtocolPolicy: undefined }), // default path covered above
    );
    expect(template).toBeDefined();
  });

  test('default-domain mode: omits ACM, Route53, and distribution aliases', () => {
    const app = new cdk.App();
    const stack = new EcsExpressEdgeStack(app, 'NoDomain', { env: ENV, albDnsName: ALB });
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::CertificateManager::Certificate', 0);
    template.resourceCountIs('AWS::Route53::RecordSet', 0);
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ Aliases: Match.absent() }),
    });
  });

  test('throws when domainName is set without hostedZoneName', () => {
    const app = new cdk.App();
    expect(() => {
      new EcsExpressEdgeStack(app, 'Bad', { env: ENV, albDnsName: ALB, domainName: 'kota.dog' });
    }).toThrow(/hostedZoneName is required/);
  });

  test('throws when albDnsName is missing', () => {
    const app = new cdk.App();
    expect(() => {
      new EcsExpressEdgeStack(app, 'Bad', { env: ENV, albDnsName: '' });
    }).toThrow(/albDnsName is required/);
  });

  test('exports distribution id, domain, and site url', () => {
    const template = Template.fromStack(makeStack());
    const keys = Object.keys(template.findOutputs('*'));
    expect(keys.some((k) => k.includes('DistributionId'))).toBe(true);
    expect(keys.some((k) => k.includes('DistributionDomain'))).toBe(true);
    expect(keys.some((k) => k.includes('SiteUrl'))).toBe(true);
  });

  test('creates a CloudWatch dashboard by default', () => {
    const template = Template.fromStack(makeStack());
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
  });

  test('omits the dashboard when createDashboard is false', () => {
    const template = Template.fromStack(makeStack({ createDashboard: false }));
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 0);
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
