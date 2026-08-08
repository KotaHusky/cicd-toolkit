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

  test('creates NO CloudFront Function (redirect stays per-stack)', () => {
    const template = Template.fromStack(makeSharedEdge());
    template.resourceCountIs('AWS::CloudFront::Function', 0);
  });

  test('publishes exactly two SSM parameters under the default prefix', () => {
    const template = Template.fromStack(makeSharedEdge());
    const prefix = '/cicd-toolkit/edge';
    for (const key of Object.values(SHARED_EDGE_SSM_KEYS)) {
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name: `${prefix}/${key}`,
        Type: 'String',
      });
    }
    template.resourceCountIs('AWS::SSM::Parameter', 2);
  });

  test('honours a custom ssmPrefix', () => {
    const template = Template.fromStack(makeSharedEdge({ ssmPrefix: '/my-org/shared-edge' }));
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: `/my-org/shared-edge/${SHARED_EDGE_SSM_KEYS.nextImageCachePolicyId}`,
    });
  });

  test('emits CfnOutputs for the two shared policy values plus prefix', () => {
    const template = Template.fromStack(makeSharedEdge());
    const keys = Object.keys(template.findOutputs('*'));
    expect(keys.some((k) => k.includes('NextImageCachePolicyId'))).toBe(true);
    expect(keys.some((k) => k.includes('SsrResponseHeadersPolicyId'))).toBe(true);
    expect(keys.some((k) => k.includes('SsmPrefix'))).toBe(true);
    // Confirm no function-related outputs
    expect(keys.some((k) => k.toLowerCase().includes('function'))).toBe(false);
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

  test('with additionalAliases: creates ONE per-stack redirect Function with hardcoded apex', () => {
    const template = Template.fromStack(
      makeSharedStack({ additionalAliases: ['www.example.com'] }),
    );
    // Function is per-stack even in shared mode (functions are not account-quota-constrained)
    template.resourceCountIs('AWS::CloudFront::Function', 1);
    const fn = Object.values(template.findResources('AWS::CloudFront::Function'))[0] as {
      Properties: { FunctionCode: string };
    };
    // Apex is hardcoded inline, not read from a header
    expect(fn.Properties.FunctionCode).toContain('301');
    expect(fn.Properties.FunctionCode).toContain('"example.com"');
    // Policies still ZERO — those are what shared mode saves
    template.resourceCountIs('AWS::CloudFront::CachePolicy', 0);
    template.resourceCountIs('AWS::CloudFront::ResponseHeadersPolicy', 0);
  });

  test('with additionalAliases in shared mode: origin does NOT set x-apex-domain', () => {
    const template = Template.fromStack(
      makeSharedStack({ additionalAliases: ['www.example.com'] }),
    );
    // No custom origin headers — the per-stack function hardcodes the apex directly
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Origins: Match.arrayWith([
          Match.objectLike({
            OriginCustomHeaders: Match.absent(),
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
    expect(fn.Properties.FunctionCode).toContain('301');
    expect(fn.Properties.FunctionCode).toContain('"example.com"');
  });
});
