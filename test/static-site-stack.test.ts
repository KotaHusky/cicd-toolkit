import { describe, test, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { StaticSiteStack } from '../lib/stacks/static-site-stack';
import { applyTags } from '../lib/constructs/standard-tags';
import { StaticSiteDashboard } from '../lib/constructs/static-site-dashboard';

const ENV = { account: '111111111111', region: 'us-east-1' };

function makeStack(overrides: Partial<ConstructorParameters<typeof StaticSiteStack>[2]> = {}) {
  const app = new cdk.App();
  return new StaticSiteStack(app, 'TestSite', {
    env: ENV,
    domainName: 'site.example.com',
    hostedZoneName: 'example.com',
    ...overrides,
  });
}

describe('StaticSiteStack', () => {
  test('creates a private S3 bucket with public access blocked', () => {
    const template = Template.fromStack(makeStack());
    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  test('creates a CloudFront distribution with the requested aliases', () => {
    const template = Template.fromStack(makeStack({ additionalAliases: ['www.example.com'] }));
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: Match.arrayWith(['site.example.com', 'www.example.com']),
      }),
    });
  });

  test('creates an ACM certificate with DNS validation', () => {
    const template = Template.fromStack(makeStack());
    template.resourceCountIs('AWS::CertificateManager::Certificate', 1);
    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'site.example.com',
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

  test('wires SPA fallback when spaFallback is true', () => {
    const template = Template.fromStack(makeStack({ spaFallback: true }));
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/index.html' }),
          Match.objectLike({ ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/index.html' }),
        ]),
      }),
    });
  });

  test('omits custom error responses when spaFallback is unset', () => {
    const template = Template.fromStack(makeStack());
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.absent(),
      }),
    });
  });

  test('default-domain mode: omits ACM, Route53, and distribution aliases', () => {
    const app = new cdk.App();
    const stack = new StaticSiteStack(app, 'NoDomain', { env: ENV });
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::CertificateManager::Certificate', 0);
    template.resourceCountIs('AWS::Route53::RecordSet', 0);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: Match.absent(),
      }),
    });
    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });

  test('default-domain mode: SiteUrl output points at distribution domain', () => {
    const app = new cdk.App();
    const stack = new StaticSiteStack(app, 'NoDomain', { env: ENV });
    const template = Template.fromStack(stack);
    const outputs = template.findOutputs('SiteUrl');
    const siteUrl = Object.values(outputs)[0] as { Value: unknown };
    // Value is a Fn::Join referencing DistributionDomainName when no custom domain.
    expect(JSON.stringify(siteUrl.Value)).toContain('DomainName');
  });

  test('throws when domainName is set without hostedZoneName', () => {
    const app = new cdk.App();
    expect(() => {
      new StaticSiteStack(app, 'Bad', {
        env: ENV,
        domainName: 'site.example.com',
        // hostedZoneName omitted on purpose
      });
    }).toThrow(/hostedZoneName is required/);
  });

  test('exports bucket name and distribution id as CfnOutputs', () => {
    const template = Template.fromStack(makeStack());
    const outputs = template.findOutputs('*');
    const keys = Object.keys(outputs);
    expect(keys.some((k) => k.includes('BucketName'))).toBe(true);
    expect(keys.some((k) => k.includes('DistributionId'))).toBe(true);
    expect(keys.some((k) => k.includes('DistributionDomain'))).toBe(true);
  });
});

function bucketTags(template: Template): Map<string, string> {
  const buckets = template.findResources('AWS::S3::Bucket');
  const props = (Object.values(buckets)[0] as { Properties?: { Tags?: Array<{ Key: string; Value: string }> } }).Properties;
  return new Map((props?.Tags ?? []).map((t) => [t.Key, t.Value]));
}

describe('applyTags', () => {
  test('propagates tags to taggable resources in the stack', () => {
    const stack = makeStack();
    applyTags(stack, { Project: 'test', Environment: 'prod' });
    const tags = bucketTags(Template.fromStack(stack));
    expect(tags.get('Project')).toBe('test');
    expect(tags.get('Environment')).toBe('prod');
  });

  test('skips empty / undefined tag values', () => {
    const stack = makeStack();
    applyTags(stack, { Project: 'test', BlankKey: '' });
    const tags = bucketTags(Template.fromStack(stack));
    expect(tags.has('Project')).toBe(true);
    expect(tags.has('BlankKey')).toBe(false);
  });
});

describe('StaticSiteDashboard', () => {
  test('creates one CloudWatch dashboard referencing the distribution', () => {
    const stack = makeStack();
    new StaticSiteDashboard(stack, 'Metrics', {
      distribution: stack.distribution,
      dashboardName: 'test-dashboard',
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'test-dashboard',
    });

    // The DashboardBody is built from CDK tokens, so it serializes as a
    // Fn::Join structure rather than a literal string. Stringify the whole
    // synthesized template and assert the metric names appear somewhere
    // inside it.
    const synth = JSON.stringify(template.toJSON());
    expect(synth).toContain('Requests');
    expect(synth).toContain('4xxErrorRate');
    expect(synth).toContain('5xxErrorRate');
    expect(synth).toContain('CacheHitRate');
    expect(synth).toContain('OriginLatency');
  });
});
