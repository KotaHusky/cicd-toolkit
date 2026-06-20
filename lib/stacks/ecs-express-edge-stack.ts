import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';
import {
  EcsExpressObservability,
  ObservabilityProps,
  resolveObservability,
} from '../constructs/ecs-express-observability';

export interface EcsExpressEdgeStackProps extends cdk.StackProps {
  /**
   * The ECS Express service endpoint — the `endpoint` output of
   * `ecs-express-deploy.yml` (e.g. `ho-<hash>.ecs.us-east-1.on.aws`). This is
   * the CloudFront origin. ECS Express serves it over **HTTPS** via the managed
   * gateway, so the origin protocol defaults to HTTPS_ONLY.
   */
  albDnsName: string;
  /**
   * Custom domain (e.g. `kota.dog`). DNS is on **Cloudflare** — this stack
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
  /** Additional aliases on the same distribution (e.g. `['www.kota.dog']`). */
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
 * MCP server, create these records in the `kota.dog` zone:
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

    const origin = new origins.HttpOrigin(props.albDnsName, {
      protocolPolicy: props.originProtocolPolicy ?? cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      httpsPort: 443,
    });

    // SSR responses are dynamic: don't cache, forward everything (minus Host so
    // the gateway routes to the right service by its origin hostname).
    const ssrBehavior: cloudfront.BehaviorOptions = {
      origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      compress: true,
    };

    // Content-hashed, immutable assets: cache hard at the edge.
    const staticBehavior: cloudfront.BehaviorOptions = {
      origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      compress: true,
    };

    // The Next.js image optimizer (`/_next/image`) keys responses on the
    // `?url`, `w` and `q` query string and the `Accept` header (avif/webp
    // negotiation). CACHING_OPTIMIZED drops the query string, so the optimizer
    // receives a bare `/_next/image` and 400s with "url parameter is required".
    // Include those in the cache key (so each size caches separately) and
    // forward them to the origin.
    const imageCachePolicy = new cloudfront.CachePolicy(this, 'NextImageCachePolicy', {
      comment: 'Next.js /_next/image: query string + Accept in cache key',
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList('Accept'),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
      minTtl: cdk.Duration.seconds(0),
      defaultTtl: cdk.Duration.days(1),
      maxTtl: cdk.Duration.days(365),
    });

    const imageBehavior: cloudfront.BehaviorOptions = {
      origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      cachePolicy: imageCachePolicy,
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
