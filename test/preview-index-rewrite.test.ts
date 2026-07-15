import { describe, test, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { StaticSiteStack } from '../lib/stacks/static-site-stack';

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

describe('StaticSiteStack — previewIndexRewrite', () => {
  test('attaches a CloudFront Function on viewer-request when previewIndexRewrite is true', () => {
    const template = Template.fromStack(makeStack({ previewIndexRewrite: true }));

    // A CloudFront::Function resource must be created.
    template.resourceCountIs('AWS::CloudFront::Function', 1);

    // The distribution's default cache behaviour must reference that function
    // as a viewer-request association.
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          FunctionAssociations: Match.arrayWith([
            Match.objectLike({ EventType: 'viewer-request' }),
          ]),
        }),
      }),
    });
  });

  test('does not attach a CloudFront Function when previewIndexRewrite is false (default)', () => {
    const template = Template.fromStack(makeStack());
    template.resourceCountIs('AWS::CloudFront::Function', 0);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          FunctionAssociations: Match.absent(),
        }),
      }),
    });
  });

  test('does not attach a CloudFront Function when previewIndexRewrite is explicitly false', () => {
    const template = Template.fromStack(makeStack({ previewIndexRewrite: false }));
    template.resourceCountIs('AWS::CloudFront::Function', 0);
  });

  test('rewrite function code rewrites trailing-slash URIs to index.html', () => {
    const template = Template.fromStack(makeStack({ previewIndexRewrite: true }));
    const functions = template.findResources('AWS::CloudFront::Function');
    const fnProps = Object.values(functions)[0] as {
      Properties?: { FunctionCode?: string };
    };
    const code = fnProps?.Properties?.FunctionCode ?? '';
    // Verify the rewrite logic is present in the emitted function code.
    expect(code).toContain('index.html');
    expect(code).toContain('uri');
  });

  test('coexists with spaFallback: both CloudFront Function and custom error responses are present', () => {
    const template = Template.fromStack(
      makeStack({ previewIndexRewrite: true, spaFallback: true }),
    );

    // CloudFront Function for index rewrite.
    template.resourceCountIs('AWS::CloudFront::Function', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          FunctionAssociations: Match.arrayWith([
            Match.objectLike({ EventType: 'viewer-request' }),
          ]),
        }),
      }),
    });

    // SPA fallback custom error responses.
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/index.html' }),
          Match.objectLike({ ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/index.html' }),
        ]),
      }),
    });
  });

  test('spaFallback alone does not create a CloudFront Function', () => {
    const template = Template.fromStack(makeStack({ spaFallback: true }));
    template.resourceCountIs('AWS::CloudFront::Function', 0);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          FunctionAssociations: Match.absent(),
        }),
      }),
    });
  });
});
