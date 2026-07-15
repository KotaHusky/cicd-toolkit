import { describe, test, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SharedEdgeStack, SHARED_EDGE_SSM_KEYS } from '../lib/stacks/shared-edge-stack';
import { EcsExpressEdgeStack } from '../lib/stacks/ecs-express-edge-stack';

const ENV = { account: '111111111111', region: 'us-east-1' };
const ENDPOINT = 'ho-6aa8cf0a33c84998b3e7bd4906bbf686.ecs.us-east-1.on.aws';

// ---------------------------------------------------------------------------
// SharedEdgeStack
// ---------------------------------------------------------------------------

describe('SharedEdgeStack', () => {
  function makeSharedEdge(props?: Partial<ConstructorParameters<typeof SharedEdgeStack>[2]>) {
    const app = new cdk.App();
    return new SharedEdgeStack(app, 'SharedEdge', { env: ENV, ...props });
  }

  test('creates exactly one CachePolicy (NextImageCache)', () => {
    const template = Template.fromStack(makeSharedEdge());
    template.resourceCountIs('AWS::CloudFront::CachePolicy', 1);
    template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({
        Comment: 'Next.js image optimizer (url/w/q + Accept)',
      }),
    });
  });

  test('creates exactly one ResponseHeadersPolicy (SsrCacheControl)', () => {
    const template = Template.fromStack(makeSharedEdge());
    template.resourceCountIs('AWS::CloudFront::ResponseHeadersPolicy', 1);
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        CustomHeadersConfig: Match.objectLike({
          Items: Match.arrayWith([
            Match.objectLike({ Header: 'cache-control', Value: 'no-cache, must-revalidate' }),
          ]),
        }),
      }),
    });
  });

  test('creates exactly one CloudFront Function (WwwAliasRedirect)', () => {
    const template = Template.fromStack(makeSharedEdge());
    template.resourceCountIs('AWS::CloudFront::Function', 1);
    const fn = Object.values(template.findResources('AWS::CloudFront::Function'))[0] as {
      Properties: { FunctionCode: string; FunctionConfig: { Runtime: string } };
    };
    expect(fn.Properties.FunctionCode).toContain('x-apex-domain');
    expect(fn.Properties.FunctionConfig.Runtime).toBe('cloudfront-js-2.0');
  });

  test('publishes four SSM parameters under the default prefix', () => {
    const template = Template.fromStack(makeSharedEdge());
    // Verify all four SSM parameter names land under the default prefix
    const prefix = '/cicd-toolkit/edge';
    for (const key of Object.values(SHARED_EDGE_SSM_KEYS)) {
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name: `${prefix}/${key}`,
        Type: 'String',
      });
    }
    // Exactly four SSM parameters — no extra ones
    template.resourceCountIs('AWS::SSM::Parameter', 4);
  });

  test('honours a custom ssmPrefix', () => {
    const template = Template.fromStack(makeSharedEdge({ ssmPrefix: '/my-org/shared-edge' }));
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: `/my-org/shared-edge/${SHARED_EDGE_SSM_KEYS.nextImageCachePolicyId}`,
    });
  });

  test('emits CfnOutputs for all four shared values', () => {
    const template = Template.fromStack(makeSharedEdge());
    const keys = Object.keys(template.findOutputs('*'));
    expect(keys.some((k) => k.includes('NextImageCachePolicyId'))).toBe(true);
    expect(keys.some((k) => k.includes('SsrResponseHeadersPolicyId'))).toBe(true);
    expect(keys.some((k) => k.includes('WwwRedirectFunctionArn'))).toBe(true);
    expect(keys.some((k) => k.includes('WwwRedirectFunctionName'))).toBe(true);
  });

  test('creates NO CloudFront Distribution', () => {
    const template = Template.fromStack(makeSharedEdge());
    template.resourceCountIs('AWS::CloudFront::Distribution', 0);
  });
});

// ---------------------------------------------------------------------------
// EcsExpressEdgeStack with sharedEdge prop
// ---------------------------------------------------------------------------

describe('EcsExpressEdgeStack with sharedEdge', () => {
  function makeSharedStack(
    overrides: Partial<ConstructorParameters<typeof EcsExpressEdgeStack>[2]> = {},
  ) {
    const app = new cdk.App();
    return new EcsExpressEdgeStack(app, 'AppEdge', {
      env: ENV,
      albDnsName: ENDPOINT,
      domainName: 'example.com',
      sharedEdge: {},
      ...overrides,
    });
  }

  test('creates ZERO AWS::CloudFront::CachePolicy resources', () => {
    const template = Template.fromStack(makeSharedStack());
    template.resourceCountIs('AWS::CloudFront::CachePolicy', 0);
  });

  test('creates ZERO AWS::CloudFront::ResponseHeadersPolicy resources', () => {
    const template = Template.fromStack(makeSharedStack());
    template.resourceCountIs('AWS::CloudFront::ResponseHeadersPolicy', 0);
  });

  test('creates ZERO AWS::CloudFront::Function resources when no additionalAliases', () => {
    const template = Template.fromStack(makeSharedStack());
    template.resourceCountIs('AWS::CloudFront::Function', 0);
  });

  test('resolves image cache policy via SSM token (deploy-time resolve, no CachePolicy resource)', () => {
    const template = Template.fromStack(makeSharedStack());
    // The /_next/image* behavior must reference a CachePolicyId that is an SSM
    // dynamic reference (rendered as a CloudFormation dynamic reference or
    // Fn::GetParam — either way it is NOT a literal UUID string at synth time).
    const dist = Object.values(
      template.findResources('AWS::CloudFront::Distribution'),
    )[0] as {
      Properties: {
        DistributionConfig: {
          CacheBehaviors?: Array<{ PathPattern: string; CachePolicyId: unknown }>;
        };
      };
    };
    const imageBehavior = (dist.Properties.DistributionConfig.CacheBehaviors ?? []).find(
      (b) => b.PathPattern === '/_next/image*',
    );
    expect(imageBehavior).toBeDefined();
    // CachePolicyId must be a non-literal token (object/ref, not a plain UUID string)
    expect(typeof imageBehavior!.CachePolicyId).not.toBe('string');
  });

  test('resolves response-headers policy via SSM token', () => {
    const template = Template.fromStack(makeSharedStack());
    const dist = Object.values(
      template.findResources('AWS::CloudFront::Distribution'),
    )[0] as {
      Properties: {
        DistributionConfig: {
          DefaultCacheBehavior: { ResponseHeadersPolicyId?: unknown };
        };
      };
    };
    // ResponseHeadersPolicyId on the default (SSR) behavior must be a token
    const id = dist.Properties.DistributionConfig.DefaultCacheBehavior.ResponseHeadersPolicyId;
    expect(id).toBeDefined();
    expect(typeof id).not.toBe('string');
  });

  test('still creates ONE Distribution', () => {
    const template = Template.fromStack(makeSharedStack());
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });

  test('still enforces HTTPS, custom domain alias, and SSR POST methods', () => {
    const template = Template.fromStack(makeSharedStack());
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: Match.arrayWith(['example.com']),
        DefaultCacheBehavior: Match.objectLike({
          AllowedMethods: Match.arrayWith(['PUT', 'PATCH', 'POST', 'DELETE']),
          ViewerProtocolPolicy: 'redirect-to-https',
        }),
      }),
    });
  });

  test('with additionalAliases: imports shared function (no new Function resource)', () => {
    const template = Template.fromStack(
      makeSharedStack({ additionalAliases: ['www.example.com'] }),
    );
    // The shared function is imported via fromFunctionAttributes — no new resource
    template.resourceCountIs('AWS::CloudFront::Function', 0);
    // But the distribution must still have a function association on behaviors
    const dist = Object.values(
      template.findResources('AWS::CloudFront::Distribution'),
    )[0] as {
      Properties: {
        DistributionConfig: {
          DefaultCacheBehavior: {
            FunctionAssociations?: Array<{ EventType: string; FunctionARN: unknown }>;
          };
        };
      };
    };
    const assocs =
      dist.Properties.DistributionConfig.DefaultCacheBehavior.FunctionAssociations ?? [];
    expect(assocs.length).toBeGreaterThan(0);
    const viewerReqAssoc = assocs.find((a) => a.EventType === 'viewer-request');
    expect(viewerReqAssoc).toBeDefined();
  });

  test('with additionalAliases in shared mode: origin gets x-apex-domain custom header', () => {
    const template = Template.fromStack(
      makeSharedStack({ additionalAliases: ['www.example.com'] }),
    );
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Origins: Match.arrayWith([
          Match.objectLike({
            OriginCustomHeaders: Match.arrayWith([
              Match.objectLike({ HeaderName: 'x-apex-domain', HeaderValue: 'example.com' }),
            ]),
          }),
        ]),
      }),
    });
  });

  test('uses a custom ssmPrefix when specified', () => {
    const app = new cdk.App();
    const template = Template.fromStack(
      new EcsExpressEdgeStack(app, 'AppEdge2', {
        env: ENV,
        albDnsName: ENDPOINT,
        domainName: 'example.com',
        sharedEdge: { ssmPrefix: '/my-org/shared-edge' },
      }),
    );
    // Verify no CachePolicy or ResponseHeadersPolicy resource was created
    template.resourceCountIs('AWS::CloudFront::CachePolicy', 0);
    template.resourceCountIs('AWS::CloudFront::ResponseHeadersPolicy', 0);
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility: sharedEdge absent = original per-stack behavior
// ---------------------------------------------------------------------------

describe('EcsExpressEdgeStack without sharedEdge (backward compat)', () => {
  function makeStack(
    overrides: Partial<ConstructorParameters<typeof EcsExpressEdgeStack>[2]> = {},
  ) {
    const app = new cdk.App();
    return new EcsExpressEdgeStack(app, 'TestEdge', {
      env: ENV,
      albDnsName: ENDPOINT,
      domainName: 'example.com',
      ...overrides,
    });
  }

  test('still creates its own CachePolicy when sharedEdge is absent', () => {
    const template = Template.fromStack(makeStack());
    template.resourceCountIs('AWS::CloudFront::CachePolicy', 1);
  });

  test('still creates its own ResponseHeadersPolicy when sharedEdge is absent', () => {
    const template = Template.fromStack(makeStack());
    template.resourceCountIs('AWS::CloudFront::ResponseHeadersPolicy', 1);
  });

  test('still creates a per-stack CloudFront Function for additionalAliases', () => {
    const template = Template.fromStack(makeStack({ additionalAliases: ['www.example.com'] }));
    template.resourceCountIs('AWS::CloudFront::Function', 1);
    const fn = Object.values(template.findResources('AWS::CloudFront::Function'))[0] as {
      Properties: { FunctionCode: string };
    };
    // Original function hardcodes the apex, not the x-apex-domain header approach
    expect(fn.Properties.FunctionCode).toContain('301');
    expect(fn.Properties.FunctionCode).toContain('"example.com"');
  });
});
