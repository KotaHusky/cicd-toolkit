import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

/** SSM parameter name suffixes published by {@link SharedEdgeStack}. */
export const SHARED_EDGE_SSM_KEYS = {
  nextImageCachePolicyId: 'next-image-cache-policy-id',
  ssrResponseHeadersPolicyId: 'ssr-response-headers-policy-id',
} as const;

export interface SharedEdgeStackProps extends cdk.StackProps {
  /**
   * SSM prefix under which the two shared-primitive parameter names are
   * published. Must start with `/` and must not end with `/`.
   * @default '/cicd-toolkit/edge'
   */
  ssmPrefix?: string;
}

/**
 * Account-level shared CloudFront primitives for Next.js / ECS Express apps.
 *
 * AWS caps accounts at ~20 cache policies and ~20 response-headers policies.
 * With `EcsExpressEdgeStack` creating one of each per stack, ~10 apps × dev/prod
 * hits the wall. Deploy this stack **once per account/region** and point every
 * `EcsExpressEdgeStack` at it via the `sharedEdge` prop to stay well within quota.
 *
 * Primitives created (two):
 * - **NextImageCache** — CachePolicy keyed on url/w/q query strings + Accept header
 * - **SsrCacheControl** — ResponseHeadersPolicy that forces `no-cache, must-revalidate`
 *
 * Both IDs are published to SSM Parameter Store under `ssmPrefix` so consumer
 * stacks can resolve them at deploy time without a cross-stack dependency.
 *
 * The www→apex redirect CloudFront Function is intentionally NOT shared here.
 * CloudFront Functions have a ~100/account quota (vs ~20 for policies), so
 * each `EcsExpressEdgeStack` that needs a redirect creates its own per-stack
 * function with the apex domain hardcoded — that is correct and not a quota risk
 * even at 50 alias-using apps.
 *
 * ### Bootstrap once per account
 * Deploy in the SAME region as the consuming app stacks: the SSM parameters
 * are regional, so app stacks resolve them only from their own region. (The
 * CloudFront policies themselves are global and can be managed from any
 * region; us-east-1 below just matches where the edge stacks live for ACM.)
 * ```ts
 * new SharedEdgeStack(app, 'SharedEdge', { env: { account: '111111111111', region: 'us-east-1' } });
 * ```
 *
 * ### Per-app reference
 * ```ts
 * new EcsExpressEdgeStack(app, 'MyAppEdge', {
 *   env: { account: '111111111111', region: 'us-east-1' },
 *   albDnsName: 'ho-abc123.ecs.us-east-1.on.aws',
 *   domainName: 'example.com',
 *   sharedEdge: {},   // uses default ssmPrefix '/cicd-toolkit/edge'
 * });
 * ```
 *
 * IMPORTANT: this stack must be deployed in us-east-1 — CloudFront policies are
 * global resources but CloudFormation only accepts them from the us-east-1 control plane.
 */
export class SharedEdgeStack extends cdk.Stack {
  /** Resolved SSM prefix (without trailing slash). */
  public readonly ssmPrefix: string;

  /** The shared cache policy for Next.js `/_next/image*` requests. */
  public readonly nextImageCachePolicy: cloudfront.CachePolicy;
  /** The shared response-headers policy that forces SSR responses to revalidate. */
  public readonly ssrResponseHeadersPolicy: cloudfront.ResponseHeadersPolicy;

  /** SSM parameter that holds {@link nextImageCachePolicy}.cachePolicyId. */
  public readonly nextImageCachePolicyIdParam: ssm.StringParameter;
  /** SSM parameter that holds {@link ssrResponseHeadersPolicy}.responseHeadersPolicyId. */
  public readonly ssrResponseHeadersPolicyIdParam: ssm.StringParameter;

  constructor(scope: Construct, id: string, props?: SharedEdgeStackProps) {
    super(scope, id, props);

    this.ssmPrefix = props?.ssmPrefix ?? '/cicd-toolkit/edge';

    // Next.js image optimizer: /_next/image?url=...&w=...&q=... — the query
    // string carries the params, so it must be forwarded AND keyed in the cache
    // (CACHING_OPTIMIZED drops query strings, which makes the optimizer 400).
    this.nextImageCachePolicy = new cloudfront.CachePolicy(this, 'NextImageCache', {
      comment: 'Next.js image optimizer (url/w/q + Accept)',
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList('Accept'),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
      defaultTtl: cdk.Duration.days(7),
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.days(365),
    });

    // SSR responses are dynamic: don't cache, forward everything (minus Host so
    // the gateway routes to the right service by its origin hostname).
    // Force HTML to revalidate on every request so deploys are immediately
    // visible. The SSR origin (Next.js) emits a long `stale-while-revalidate`,
    // which makes browsers serve the previous page while refreshing in the
    // background; override the header at the edge so clients always revalidate.
    this.ssrResponseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'SsrCacheControl', {
      customHeadersBehavior: {
        customHeaders: [
          { header: 'cache-control', value: 'no-cache, must-revalidate', override: true },
        ],
      },
    });

    // Publish IDs to SSM so consumer stacks resolve at deploy time
    // without hard CloudFormation cross-stack dependencies.
    this.nextImageCachePolicyIdParam = new ssm.StringParameter(
      this,
      'NextImageCachePolicyIdParam',
      {
        parameterName: `${this.ssmPrefix}/${SHARED_EDGE_SSM_KEYS.nextImageCachePolicyId}`,
        stringValue: this.nextImageCachePolicy.cachePolicyId,
        description: 'Shared NextImageCache cache-policy ID (cicd-toolkit SharedEdgeStack)',
      },
    );

    this.ssrResponseHeadersPolicyIdParam = new ssm.StringParameter(
      this,
      'SsrResponseHeadersPolicyIdParam',
      {
        parameterName: `${this.ssmPrefix}/${SHARED_EDGE_SSM_KEYS.ssrResponseHeadersPolicyId}`,
        stringValue: this.ssrResponseHeadersPolicy.responseHeadersPolicyId,
        description:
          'Shared SsrCacheControl response-headers-policy ID (cicd-toolkit SharedEdgeStack)',
      },
    );

    // CfnOutputs for discoverability post-deploy
    new cdk.CfnOutput(this, 'NextImageCachePolicyId', {
      value: this.nextImageCachePolicy.cachePolicyId,
      description: 'Shared NextImageCache cache-policy ID',
    });
    new cdk.CfnOutput(this, 'SsrResponseHeadersPolicyId', {
      value: this.ssrResponseHeadersPolicy.responseHeadersPolicyId,
      description: 'Shared SsrCacheControl response-headers-policy ID',
    });
    new cdk.CfnOutput(this, 'SsmPrefix', {
      value: this.ssmPrefix,
      description: 'SSM prefix used — pass as sharedEdge.ssmPrefix in EcsExpressEdgeStack',
    });
  }
}
