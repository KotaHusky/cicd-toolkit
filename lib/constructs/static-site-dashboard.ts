import { Duration } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

export interface StaticSiteDashboardProps {
  /** CloudFront distribution to graph. */
  distribution: cloudfront.IDistribution;
  /** Dashboard name. Defaults to `${id}-static-site`. */
  dashboardName?: string;
  /** Default widget time period. Defaults to 5 minutes. */
  period?: Duration;
}

/**
 * CloudWatch dashboard with the metrics that actually matter for an
 * S3+CloudFront static site:
 *
 *   - Total requests (per period)
 *   - 4xx / 5xx error rate (%)
 *   - Cache hit ratio (%) — leading indicator for "is the site reachable"
 *   - Origin latency p50 / p99 — only spikes on cache misses
 *
 * All CloudFront metrics live in us-east-1 regardless of where your bucket
 * is, so the dashboard hard-codes that region for its metric queries.
 *
 * Project-agnostic. Pair with `applyTags()` if you want the dashboard to
 * carry your org's standard tags.
 */
export class StaticSiteDashboard extends Construct {
  public readonly dashboard: cw.Dashboard;

  constructor(scope: Construct, id: string, props: StaticSiteDashboardProps) {
    super(scope, id);

    const distributionId = props.distribution.distributionId;
    const period = props.period ?? Duration.minutes(5);

    const cfMetric = (metricName: string, statistic = 'Sum'): cw.Metric =>
      new cw.Metric({
        namespace: 'AWS/CloudFront',
        metricName,
        dimensionsMap: { DistributionId: distributionId, Region: 'Global' },
        statistic,
        period,
        region: 'us-east-1',
      });

    const requests = cfMetric('Requests', 'Sum');
    const fourXxRate = cfMetric('4xxErrorRate', 'Average');
    const fiveXxRate = cfMetric('5xxErrorRate', 'Average');
    const cacheHit = cfMetric('CacheHitRate', 'Average');
    const originLatencyP50 = cfMetric('OriginLatency', 'p50');
    const originLatencyP99 = cfMetric('OriginLatency', 'p99');
    const bytesDownloaded = cfMetric('BytesDownloaded', 'Sum');

    this.dashboard = new cw.Dashboard(this, 'Dashboard', {
      dashboardName: props.dashboardName ?? `${id}-static-site`,
      defaultInterval: Duration.hours(3),
    });

    this.dashboard.addWidgets(
      new cw.GraphWidget({
        title: 'Requests',
        left: [requests],
        leftYAxis: { min: 0 },
        width: 12,
        height: 6,
      }),
      new cw.GraphWidget({
        title: 'Error rates (%)',
        left: [fourXxRate, fiveXxRate],
        leftYAxis: { min: 0, max: 100 },
        width: 12,
        height: 6,
      }),
    );

    this.dashboard.addWidgets(
      new cw.GraphWidget({
        title: 'Cache hit ratio (%)',
        left: [cacheHit],
        leftYAxis: { min: 0, max: 100 },
        width: 12,
        height: 6,
      }),
      new cw.GraphWidget({
        title: 'Origin latency',
        left: [originLatencyP50, originLatencyP99],
        leftYAxis: { min: 0 },
        width: 12,
        height: 6,
      }),
    );

    this.dashboard.addWidgets(
      new cw.GraphWidget({
        title: 'Bytes downloaded',
        left: [bytesDownloaded],
        leftYAxis: { min: 0 },
        width: 24,
        height: 6,
      }),
    );
  }
}
