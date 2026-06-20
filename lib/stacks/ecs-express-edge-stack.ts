import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';
import { EcsExpressDashboard } from '../constructs/ecs-express-dashboard';

export interface EcsExpressEdgeStackProps extends cdk.StackProps {
  /**
   * Public DNS name of the Application Load Balancer that ECS Express Mode
   * provisions — the `endpoint` output of cicd-toolkit's `ecs-express-deploy.yml`
   * (e.g. 'homepage-alb-1234567890.us-east-1.elb.amazonaws.com'). This is the
   * CloudFront origin. The ALB is stable across service redeploys, so it only
   * changes if the ECS Express service is destroyed and recreated.
   */
  albDnsName: string;
  /** Custom domain (e.g. 'kota.dog'). Omit to use the auto-generated CloudFront
   *  domain only — no ACM cert and no Route 53 record are created (handy for a
   *  first smoke test before DNS is ready). */
  domainName?: string;
  /** Hosted zone that owns `domainName`. Required when `domainName` is set so
   *  the ACM cert can DNS-validate and the alias record can be created. For a
   *  subdomain (afterdark.kota.dog) this is still the parent zone (kota.dog). */
  hostedZoneName?: string;
  /** Create the A/AAAA alias record. Defaults to true when `domainName` is set;
   *  ignored otherwise. Set false if you manage the record outside CDK. */
  createDnsRecord?: boolean;
  /** Additional aliases served by the same distribution (e.g. ['www.kota.dog']).
   *  Each must resolve within `hostedZoneName`. Ignored when `domainName` is
   *  unset. */
  additionalAliases?: string[];
  /** CloudFront price class. Defaults to PRICE_CLASS_100 (NA + EU). */
  priceClass?: cloudfront.PriceClass;
  /** Origin protocol CloudFront uses to reach the ALB. ECS Express stands up a
   *  plain-HTTP ALB by default, so this defaults to HTTP_ONLY. Switch to
   *  HTTPS_ONLY only if you've attached a cert to the ALB's 443 listener. */
  originProtocolPolicy?: cloudfront.OriginProtocolPolicy;

  // --- Observability -------------------------------------------------------
  /** Friendly service name for the dashboard title/name. Defaults to
   *  `domainName`, else the ALB DNS name. */
  serviceName?: string;
  /** Create a CloudWatch dashboard (CloudFront + ALB + ECS) for this app.
   *  Defaults to true. */
  createDashboard?: boolean;
  /** Override the dashboard name. Defaults to `${serviceName}-ecs-express`. */
  dashboardName?: string;
  /** ALB CloudWatch dimension `app/<lb-name>/<lb-id>` (tail of the ALB ARN).
   *  Supply from the deploy workflow to add ALB widgets. */
  loadBalancerFullName?: string;
  /** Target group dimension `targetgroup/<name>/<id>` for host-health widgets. */
  targetGroupFullName?: string;
  /** ECS cluster name (from the service ARN) to add compute widgets. */
  ecsClusterName?: string;
  /** ECS service name (from the service ARN) to add compute widgets. */
  ecsServiceName?: string;
}

/**
 * TLS + CDN edge for an app deployed via ECS Express Mode.
 *
 * ECS Express only exposes a plain-HTTP ALB, so this stack puts CloudFront in
 * front: terminates TLS (ACM, us-east-1), serves the custom domain, and
 * edge-caches Next.js immutable assets while leaving SSR responses uncached.
 *
 *   viewer --HTTPS--> CloudFront --HTTP--> ALB --> Fargate (Next.js)
 *
 * There is no off-the-shelf AWS/community construct for CloudFront -> ALB ->
 * ECS Express, so this is a small purpose-built L3 composed of L2s. It mirrors
 * `StaticSiteStack` but swaps the S3 origin for the ECS Express ALB.
 *
 * Two modes (same as StaticSiteStack):
 *  1. Custom domain — pass `domainName` + `hostedZoneName`. Provisions ACM with
 *     DNS validation, sets the distribution alias, creates A/AAAA records.
 *  2. Default CloudFront domain only — omit `domainName`. Reachable via
 *     dXXXXX.cloudfront.net; no ACM or Route 53 resources.
 *
 * Deploy AFTER the app's first ECS Express deploy (it needs the ALB DNS name).
 *
 * IMPORTANT: CloudFront requires its ACM certificate in us-east-1. Deploy this
 * stack in us-east-1 (the toolkit default) so the in-stack cert is valid.
 */
export class EcsExpressEdgeStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;
  /** Only set when a custom domain is configured. */
  public readonly certificate?: acm.Certificate;
  /** Only set when a custom domain is configured. */
  public readonly hostedZone?: route53.IHostedZone;
  /** Only set when createDashboard is not false. */
  public readonly dashboard?: EcsExpressDashboard;

  constructor(scope: Construct, id: string, props: EcsExpressEdgeStackProps) {
    super(scope, id, props);

    if (!props.albDnsName) {
      throw new Error('EcsExpressEdgeStack: albDnsName is required (the ECS Express ALB endpoint).');
    }
    if (props.domainName && !props.hostedZoneName) {
      throw new Error('EcsExpressEdgeStack: hostedZoneName is required when domainName is set.');
    }

    let aliases: string[] | undefined;
    if (props.domainName) {
      aliases = [props.domainName, ...(props.additionalAliases ?? [])];
      this.hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
        domainName: props.hostedZoneName!,
      });
      this.certificate = new acm.Certificate(this, 'EdgeCertificate', {
        domainName: props.domainName,
        subjectAlternativeNames: props.additionalAliases,
        validation: acm.CertificateValidation.fromDns(this.hostedZone),
      });
    }

    const origin = new origins.HttpOrigin(props.albDnsName, {
      protocolPolicy: props.originProtocolPolicy ?? cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
      httpsPort: 443,
    });

    // SSR responses are dynamic: don't cache, forward everything (minus Host so
    // the ALB/Next sees real query strings, cookies and headers).
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

    this.distribution = new cloudfront.Distribution(this, 'EdgeDistribution', {
      defaultBehavior: ssrBehavior,
      additionalBehaviors: {
        '/_next/static/*': staticBehavior,
        '/_next/image*': staticBehavior,
      },
      domainNames: aliases,
      certificate: this.certificate,
      priceClass: props.priceClass ?? cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      comment: `ECS Express edge for ${props.domainName ?? props.albDnsName}`,
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

    const serviceName = props.serviceName ?? props.domainName ?? props.albDnsName;
    if (props.createDashboard !== false) {
      this.dashboard = new EcsExpressDashboard(this, 'Dashboard', {
        distribution: this.distribution,
        serviceName,
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
        ? 'CloudFront distribution domain (alias record points here)'
        : 'CloudFront distribution domain. Hit it directly when no custom domain is set.',
    });
    new cdk.CfnOutput(this, 'SiteUrl', {
      value: props.domainName
        ? `https://${props.domainName}`
        : `https://${this.distribution.distributionDomainName}`,
    });
  }
}
