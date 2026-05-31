import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface StaticSiteStackProps extends cdk.StackProps {
  /** Fully qualified domain name to serve from (e.g. 'kiosk.example.org'). */
  domainName: string;
  /** Hosted zone the domain lives in. The certificate uses DNS validation
   *  against this zone, and an A/AAAA alias is created if `createDnsRecord`
   *  is true (default). */
  hostedZoneName: string;
  /** Create the A/AAAA alias record. Set false if DNS is managed elsewhere. */
  createDnsRecord?: boolean;
  /** Treat the site as a single-page app: 403/404 from S3 return /index.html
   *  with status 200. Defaults to false (true static site). */
  spaFallback?: boolean;
  /** Default root object. Defaults to 'index.html'. */
  defaultRootObject?: string;
  /** CloudFront price class. Defaults to PRICE_CLASS_100 (NA + EU). */
  priceClass?: cloudfront.PriceClass;
  /** Optional additional aliases (e.g. ['www.example.org']). */
  additionalAliases?: string[];
}

/**
 * Generic static-site stack: private S3 bucket + CloudFront distribution with
 * Origin Access Control + ACM certificate (us-east-1) + optional Route 53 alias.
 *
 * Intentionally project-agnostic. Tagging and per-project conventions are the
 * caller's responsibility — pair with `applyTags()` from
 * `lib/constructs/standard-tags` if you want cost-allocation tags.
 */
export class StaticSiteStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly certificate: acm.Certificate;
  public readonly hostedZone: route53.IHostedZone;

  constructor(scope: Construct, id: string, props: StaticSiteStackProps) {
    super(scope, id, props);

    const aliases = [props.domainName, ...(props.additionalAliases ?? [])];

    this.hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: props.hostedZoneName,
    });

    this.bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
    });

    this.certificate = new acm.Certificate(this, 'SiteCertificate', {
      domainName: props.domainName,
      subjectAlternativeNames: props.additionalAliases,
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
    });

    const defaultBehavior: cloudfront.BehaviorOptions = {
      origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      compress: true,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
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

    if (props.createDnsRecord !== false) {
      const target = route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(this.distribution),
      );
      new route53.ARecord(this, 'AliasA', {
        zone: this.hostedZone,
        recordName: props.domainName,
        target,
      });
      new route53.AaaaRecord(this, 'AliasAAAA', {
        zone: this.hostedZone,
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
      description: 'CloudFront distribution domain (use for DNS if not creating record here)',
    });
    new cdk.CfnOutput(this, 'SiteUrl', {
      value: `https://${props.domainName}`,
    });
  }
}
