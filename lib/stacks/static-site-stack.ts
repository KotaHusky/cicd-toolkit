import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface StaticSiteStackProps extends cdk.StackProps {
  /** Custom domain (e.g. 'kiosk.example.org'). Omit to use the auto-generated
   *  CloudFront domain (e.g. d123abc.cloudfront.net) only — no ACM cert and
   *  no Route 53 record are created. Useful when you don't want a memorable
   *  URL (kiosk apps, internal tools, "security by obscurity"). */
  domainName?: string;
  /** Hosted zone that owns `domainName`. Required when `domainName` is set
   *  so the ACM cert can DNS-validate and the alias record can be created. */
  hostedZoneName?: string;
  /** Create the A/AAAA alias record. Defaults to true when `domainName` is
   *  set; ignored otherwise. */
  createDnsRecord?: boolean;
  /** Treat the site as a single-page app: 403/404 from S3 return /index.html
   *  with status 200. Defaults to false (true static site). */
  spaFallback?: boolean;
  /** Default root object. Defaults to 'index.html'. */
  defaultRootObject?: string;
  /** CloudFront price class. Defaults to PRICE_CLASS_100 (NA + EU). */
  priceClass?: cloudfront.PriceClass;
  /** Optional additional aliases (e.g. ['www.example.org']). Ignored when
   *  `domainName` is unset. */
  additionalAliases?: string[];
  /**
   * Attach a CloudFront Function (viewer-request) that rewrites directory
   * URIs to their index.html equivalents. Required when serving sub-path
   * deployments (e.g. PR preview environments at /previews/pr-42/) because
   * S3 REST origins do not honour S3's website-hosting directory index docs.
   *
   * Rewrite rules applied in order:
   *  1. URI ends with `/`  →  append `index.html`
   *  2. Last path segment has no `.`  →  append `/index.html`
   *     (handles bare paths like /about or /previews/pr-42/dashboard)
   *
   * Defaults to `false`.
   *
   * **Interaction with `spaFallback`:** Both props can be enabled together,
   * but note the limitation: spaFallback's custom error responses always
   * serve the ROOT `/index.html` (they are distribution-wide, not per-path),
   * so a missing client-side route inside a preview subpath falls back to
   * the PRODUCTION app, not the preview's index. Previews of SPAs with
   * client-side routing should be exercised via their entry URL (or use
   * hash routing); deep links into a preview 404-fall-back to production.
   */
  previewIndexRewrite?: boolean;
}

/**
 * Generic static-site stack: private S3 bucket + CloudFront distribution with
 * Origin Access Control + optional ACM certificate (us-east-1) + optional
 * Route 53 alias.
 *
 * Two modes:
 *  1. Custom domain — pass `domainName` + `hostedZoneName`. Provisions ACM
 *     with DNS validation, sets the distribution alias, creates A/AAAA.
 *  2. Default CloudFront domain only — omit `domainName`. The distribution
 *     is reachable via `dXXXXX.cloudfront.net` with CloudFront's default
 *     certificate. No DNS or ACM resources are created.
 *
 * Intentionally project-agnostic. Tagging and per-project conventions are the
 * caller's responsibility — pair with `applyTags()` from
 * `lib/constructs/standard-tags` if you want cost-allocation tags.
 */
export class StaticSiteStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  /** Only set when a custom domain is configured. */
  public readonly certificate?: acm.Certificate;
  /** Only set when a custom domain is configured. */
  public readonly hostedZone?: route53.IHostedZone;

  constructor(scope: Construct, id: string, props: StaticSiteStackProps = {}) {
    super(scope, id, props);

    if (props.domainName && !props.hostedZoneName) {
      throw new Error('StaticSiteStack: hostedZoneName is required when domainName is set.');
    }

    this.bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
    });

    let aliases: string[] | undefined;
    if (props.domainName) {
      aliases = [props.domainName, ...(props.additionalAliases ?? [])];
      this.hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
        domainName: props.hostedZoneName!,
      });
      this.certificate = new acm.Certificate(this, 'SiteCertificate', {
        domainName: props.domainName,
        subjectAlternativeNames: props.additionalAliases,
        validation: acm.CertificateValidation.fromDns(this.hostedZone),
      });
    }

    // Attach an index-rewrite CloudFront Function when opted in.
    // The function runs at the viewer-request event and normalises directory
    // URIs so that S3 REST origins (which ignore S3 website index docs)
    // serve index.html for bare directory paths.
    let indexRewriteFunction: cloudfront.FunctionAssociation[] | undefined;
    if (props.previewIndexRewrite) {
      const rewriteFn = new cloudfront.Function(this, 'IndexRewriteFn', {
        code: cloudfront.FunctionCode.fromInline(
          // Kept to ES5-style var/concat for maximum runtime compatibility,
          // though the JS_2_0 runtime below would allow modern syntax.
          [
            'function handler(event) {',
            '  var uri = event.request.uri;',
            // Scoped to the preview prefix so production paths are never
            // rewritten (e.g. an extensionless /about must keep hitting the
            // origin as-is for sites that emit about.html + redirects).
            '  if (uri.indexOf("/previews/") !== 0) { return event.request; }',
            '  if (uri.slice(-1) === "/") {',
            '    event.request.uri = uri + "index.html";',
            '  } else if (uri.lastIndexOf(".") <= uri.lastIndexOf("/")) {',
            '    event.request.uri = uri + "/index.html";',
            '  }',
            '  return event.request;',
            '}',
          ].join('\n'),
        ),
        runtime: cloudfront.FunctionRuntime.JS_2_0,
        comment: 'Rewrite directory URIs to index.html for S3 REST origin sub-path deployments',
      });
      indexRewriteFunction = [
        {
          function: rewriteFn,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        },
      ];
    }

    const defaultBehavior: cloudfront.BehaviorOptions = {
      origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      compress: true,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      ...(indexRewriteFunction ? { functionAssociations: indexRewriteFunction } : {}),
    };

    const errorResponses: cloudfront.ErrorResponse[] = props.spaFallback
      ? [
          { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.minutes(5) },
          { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.minutes(5) },
        ]
      : [];

    this.distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior,
      defaultRootObject: props.defaultRootObject ?? 'index.html',
      domainNames: aliases,
      certificate: this.certificate,
      priceClass: props.priceClass ?? cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      errorResponses,
    });

    if (props.domainName && props.createDnsRecord !== false) {
      const target = route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(this.distribution),
      );
      new route53.ARecord(this, 'AliasA', {
        zone: this.hostedZone!,
        recordName: props.domainName,
        target,
      });
      new route53.AaaaRecord(this, 'AliasAAAA', {
        zone: this.hostedZone!,
        recordName: props.domainName,
        target,
      });
    }

    new cdk.CfnOutput(this, 'BucketName', {
      value: this.bucket.bucketName,
      description: 'Pass this to static-s3-deploy.yml as bucket-name',
    });
    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'Pass this to static-s3-deploy.yml as distribution-id',
    });
    new cdk.CfnOutput(this, 'DistributionDomain', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain. Hit it directly when no custom domain is set.',
    });
    new cdk.CfnOutput(this, 'SiteUrl', {
      value: props.domainName
        ? `https://${props.domainName}`
        : `https://${this.distribution.distributionDomainName}`,
    });
  }
}
