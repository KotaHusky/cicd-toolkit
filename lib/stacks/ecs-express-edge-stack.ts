import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import {
  EcsExpressObservability,
  ObservabilityProps,
  resolveObservability,
} from '../constructs/ecs-express-observability';
import { SHARED_EDGE_SSM_KEYS, normalizeSsmPrefix } from './shared-edge-stack';

export interface EcsExpressEdgeStackProps extends cdk.StackProps {
  /**
   * The ECS Express service endpoint — the `endpoint` output of
   * `ecs-express-deploy.yml` (e.g. `ho-<hash>.ecs.us-east-1.on.aws`). This is
   * the CloudFront origin. ECS Express serves it over **HTTPS** via the managed
   * gateway, so the origin protocol defaults to HTTPS_ONLY.
   */
  albDnsName: string;
  /**
   * Custom domain (e.g. `example.com`). DNS is on **Cloudflare** — this stack
   * never touches Route 53. When set, CloudFront serves the alias with an ACM
   * cert; you point Cloudflare DNS at the distribution (see below). Omit to use
   * the default `dXXXX.cloudfront.net` domain (e.g. for smoke tests).
   */
  domainName?: string;
  /**
   * ARN of a **pre-validated ACM certificate in us-east-1** covering
   * `domainName`. STRONGLY recommended for CI: without it, the stack requests a
   * new cert with manual DNS validation and `cdk deploy` BLOCKS until the
   * validation CNAME exists in Cloudflare. With it, deploys never block.
   */
  certificateArn?: string;
  /** Additional aliases on the same distribution (e.g. `['www.example.com']`). */
  additionalAliases?: string[];
  /** CloudFront price class. Defaults to PRICE_CLASS_100 (NA + EU). */
  priceClass?: cloudfront.PriceClass;
  /** Origin protocol CloudFront uses to reach the ECS Express endpoint.
   *  Defaults to HTTPS_ONLY (the `.on.aws` gateway is HTTPS-only). */
  originProtocolPolicy?: cloudfront.OriginProtocolPolicy;

  // --- Observability (opt-in) ----------------------------------------------
  /** Friendly service name for dashboard/alarm naming. Defaults to
   *  `domainName`, else the endpoint. */
  serviceName?: string;
  /** Opt-in observability (dashboard, alarms, access logs, retention, X-Ray
   *  flag) with dev/prod tiers. OMIT to create nothing. */
  observability?: ObservabilityProps;
  /** Override the dashboard name. Defaults to `${serviceName}-ecs-express`. */
  dashboardName?: string;
  /** ALB dimension `app/<lb-name>/<lb-id>` — enables ALB widgets + alarms. */
  loadBalancerFullName?: string;
  /** Target group dimension `targetgroup/<name>/<id>` for host-health. */
  targetGroupFullName?: string;
  /** ECS cluster name (default `default`) for compute widgets + alarms. */
  ecsClusterName?: string;
  /** ECS service name for compute widgets + alarms. */
  ecsServiceName?: string;

  // --- Shared account-level edge primitives (opt-in) -----------------------
  /**
   * When set, the stack resolves the shared CloudFront **cache policy** and
   * **response-headers policy** from SSM rather than creating per-stack resources.
   * This sidesteps the AWS per-account quota of ~20 cache policies and ~20
   * response-headers policies (~10 apps × dev/prod hits the wall without sharing).
   * Deploy {@link SharedEdgeStack} once per account and pass this prop to every
   * app stack that runs in that account.
   *
   * The www→apex redirect CloudFront Function is always created per-stack
   * regardless of this prop (functions have a ~100/account quota, not ~20).
   *
   * The `ssmPrefix` must match the `ssmPrefix` used when deploying
   * `SharedEdgeStack` (default: `'/cicd-toolkit/edge'`).
   *
   * Omit this prop entirely to retain the original per-stack behavior.
   */
  sharedEdge?: {
    /**
     * SSM prefix where `SharedEdgeStack` published its primitives.
     * @default '/cicd-toolkit/edge'
     */
    ssmPrefix?: string;
  };
}

/**
 * TLS + CDN edge for an app deployed via ECS Express Mode, with **Cloudflare**
 * for DNS (Route 53 is intentionally not used anywhere in this construct).
 *
 *   viewer --HTTPS--> CloudFront --HTTPS--> ECS Express (.on.aws) --> Next.js
 *
 * CloudFront terminates TLS for the custom domain (ACM, us-east-1), edge-caches
 * Next.js immutable assets, and leaves SSR responses uncached. No off-the-shelf
 * construct covers CloudFront -> ECS Express, so this is a small L3 of L2s.
 *
 * Modes:
 *  1. Custom domain on Cloudflare — pass `domainName` (+ `certificateArn` for
 *     CI). CloudFront gets the alias + cert; you add the Cloudflare records.
 *  2. Default CloudFront domain — omit `domainName`. Reachable at
 *     `dXXXX.cloudfront.net`; no ACM resources.
 *
 * ### Cloudflare DNS (via the Cloudflare MCP server)
 * After deploy, read the `DistributionDomain` output and, using the Cloudflare
 * MCP server, create these records in the `example.com` zone:
 *   1. CNAME `<domainName>` -> `<DistributionDomain>` (DNS-only / grey-cloud;
 *      do NOT proxy — CloudFront already fronts it).
 *   2. If the stack minted the cert (no `certificateArn`), also add the ACM
 *      validation CNAME ACM shows as "pending" (name+value from the ACM cert),
 *      then re-run the deploy. Leave it in place for auto-renewal.
 * Apex domains: enable Cloudflare CNAME flattening for the root record.
 *
 * IMPORTANT: the ACM cert must be in us-east-1 — deploy this stack there.
 */
export class EcsExpressEdgeStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;
  /** Only set when a custom domain is configured. */
  public readonly certificate?: acm.ICertificate;
  /** Only set when observability is enabled. */
  public readonly observability?: EcsExpressObservability;

  constructor(scope: Construct, id: string, props: EcsExpressEdgeStackProps) {
    super(scope, id, props);

    if (!props.albDnsName) {
      throw new Error('EcsExpressEdgeStack: albDnsName is required (the ECS Express endpoint).');
    }

    let aliases: string[] | undefined;
    if (props.domainName) {
      aliases = [props.domainName, ...(props.additionalAliases ?? [])];
      this.certificate = props.certificateArn
        ? acm.Certificate.fromCertificateArn(this, 'EdgeCertificate', props.certificateArn)
        : new acm.Certificate(this, 'EdgeCertificate', {
            domainName: props.domainName,
            subjectAlternativeNames: props.additionalAliases,
            // External DNS (Cloudflare): manual validation. Deploy blocks until
            // the validation CNAME is added in Cloudflare (use the MCP server).
            validation: acm.CertificateValidation.fromDns(),
          });
    }

    const obs = props.observability ? resolveObservability(props.observability) : undefined;

    // Redirect any non-primary alias (e.g. www.example.com) to the primary domain
    // with a 301 — at the edge, before the origin (so it works even though the
    // origin request policy strips Host).
    //
    // CloudFront Functions have a ~100/account quota (vs ~20 for policies), so a
    // per-stack function with the apex hardcoded is safe even at 50 alias-using apps.
    // The two account-capped resources (CachePolicy, ResponseHeadersPolicy) are what
    // SharedEdgeStack shares; functions stay per-stack in all modes.
    let fnAssoc: cloudfront.FunctionAssociation[] | undefined;
    if (props.domainName && (props.additionalAliases?.length ?? 0) > 0) {
      const apex = JSON.stringify(props.domainName);
      const aliasRedirect = new cloudfront.Function(this, 'AliasRedirect', {
        runtime: cloudfront.FunctionRuntime.JS_2_0,
        comment: `Redirect non-${props.domainName} hosts to the apex (301)`,
        code: cloudfront.FunctionCode.fromInline(
          `function handler(event){var r=event.request;var h=r.headers.host;` +
            `if(h&&h.value!==${apex}){var qs=r.querystring;var q='';` +
            `for(var k in qs){q+=(q?'&':'?')+k+(qs[k].value?('='+qs[k].value):'');}` +
            `return{statusCode:301,statusDescription:'Moved Permanently',` +
            `headers:{location:{value:'https://'+${apex}+r.uri+q}}};}return r;}`,
        ),
      });
      fnAssoc = [{ function: aliasRedirect, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }];
    }

    const origin = new origins.HttpOrigin(props.albDnsName, {
      protocolPolicy: props.originProtocolPolicy ?? cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      httpsPort: 443,
    });

    // SSR responses are dynamic: don't cache, forward everything (minus Host so
    // the gateway routes to the right service by its origin hostname).
    // Force HTML to revalidate on every request so deploys are immediately
    // visible. The SSR origin (Next.js) emits a long `stale-while-revalidate`,
    // which makes browsers serve the previous page while refreshing in the
    // background; override the header at the edge so clients always revalidate.
    //
    // In shared mode, resolve the response-headers policy from SSM rather than
    // creating a new per-stack AWS::CloudFront::ResponseHeadersPolicy resource.
    const ssrResponseHeadersPolicy: cloudfront.IResponseHeadersPolicy = props.sharedEdge
      ? cloudfront.ResponseHeadersPolicy.fromResponseHeadersPolicyId(
          this,
          'SsrCacheControl',
          ssm.StringParameter.valueForStringParameter(
            this,
            `${normalizeSsmPrefix(props.sharedEdge.ssmPrefix ?? '/cicd-toolkit/edge')}/${SHARED_EDGE_SSM_KEYS.ssrResponseHeadersPolicyId}`,
          ),
        )
      : new cloudfront.ResponseHeadersPolicy(this, 'SsrCacheControl', {
          customHeadersBehavior: {
            customHeaders: [
              { header: 'cache-control', value: 'no-cache, must-revalidate', override: true },
            ],
          },
        });

    const ssrBehavior: cloudfront.BehaviorOptions = {
      origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      responseHeadersPolicy: ssrResponseHeadersPolicy,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      functionAssociations: fnAssoc,
      compress: true,
    };

    // Content-hashed, immutable assets: cache hard at the edge.
    const staticBehavior: cloudfront.BehaviorOptions = {
      origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      functionAssociations: fnAssoc,
      compress: true,
    };

    // Next.js image optimizer: /_next/image?url=...&w=...&q=... — the query
    // string carries the params, so it must be forwarded AND keyed in the cache
    // (CACHING_OPTIMIZED drops query strings, which makes the optimizer 400).
    //
    // In shared mode, resolve the cache policy from SSM rather than creating a
    // new per-stack AWS::CloudFront::CachePolicy resource.
    const imageCachePolicy: cloudfront.ICachePolicy = props.sharedEdge
      ? cloudfront.CachePolicy.fromCachePolicyId(
          this,
          'NextImageCache',
          ssm.StringParameter.valueForStringParameter(
            this,
            `${normalizeSsmPrefix(props.sharedEdge.ssmPrefix ?? '/cicd-toolkit/edge')}/${SHARED_EDGE_SSM_KEYS.nextImageCachePolicyId}`,
          ),
        )
      : new cloudfront.CachePolicy(this, 'NextImageCache', {
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
    const imageBehavior: cloudfront.BehaviorOptions = {
      origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      cachePolicy: imageCachePolicy,
      functionAssociations: fnAssoc,
      compress: true,
    };

    this.distribution = new cloudfront.Distribution(this, 'EdgeDistribution', {
      defaultBehavior: ssrBehavior,
      additionalBehaviors: {
        '/_next/static/*': staticBehavior,
        '/_next/image*': imageBehavior,
      },
      domainNames: aliases,
      certificate: this.certificate,
      priceClass: props.priceClass ?? cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      // CloudFront standard access logs (CDK provisions the bucket). CloudFront
      // fronts all traffic, so these are the meaningful access logs.
      enableLogging: obs?.accessLogs ?? false,
      comment: `ECS Express edge for ${props.domainName ?? props.albDnsName}`,
    });

    const serviceName = props.serviceName ?? props.domainName ?? props.albDnsName;
    if (obs) {
      this.observability = new EcsExpressObservability(this, 'Observability', {
        config: obs,
        serviceName,
        distribution: this.distribution,
        dashboardName: props.dashboardName,
        loadBalancerFullName: props.loadBalancerFullName,
        targetGroupFullName: props.targetGroupFullName,
        ecsClusterName: props.ecsClusterName,
        ecsServiceName: props.ecsServiceName,
      });
    }

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'Pass to deploy workflows for CloudFront cache invalidation',
    });
    new cdk.CfnOutput(this, 'DistributionDomain', {
      value: this.distribution.distributionDomainName,
      description: props.domainName
        ? `Cloudflare: CNAME ${props.domainName} -> this value (DNS-only / grey-cloud)`
        : 'CloudFront distribution domain. Hit it directly when no custom domain is set.',
    });
    new cdk.CfnOutput(this, 'SiteUrl', {
      value: props.domainName
        ? `https://${props.domainName}`
        : `https://${this.distribution.distributionDomainName}`,
    });
  }
}
