import { Duration } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

export interface EcsExpressDashboardProps {
  /** CloudFront distribution in front of the app (always graphed). */
  distribution: cloudfront.IDistribution;
  /** Friendly app/service name used in the dashboard title + header. */
  serviceName: string;
  /** Dashboard name. Defaults to `${serviceName}-ecs-express`. */
  dashboardName?: string;
  /** Default widget time period. Defaults to 5 minutes. */
  period?: Duration;
  /**
   * ALB CloudWatch dimension value, i.e. `app/<lb-name>/<lb-id>` (the tail of
   * the ALB ARN). ECS Express creates the ALB outside CDK, so pass this from
   * the deploy workflow if you want ALB widgets. Omit to skip the ALB section.
   */
  loadBalancerFullName?: string;
  /**
   * Target group dimension value, i.e. `targetgroup/<name>/<id>`. Required for
   * the healthy/unhealthy host count widget. Omit to skip just that widget.
   */
  targetGroupFullName?: string;
  /** ECS cluster name (from the service ARN). Omit to skip the ECS section. */
  ecsClusterName?: string;
  /** ECS service name (from the service ARN). Omit to skip the ECS section. */
  ecsServiceName?: string;
}

/**
 * Comprehensive CloudWatch dashboard for an app deployed via ECS Express Mode
 * and fronted by CloudFront. It graphs the full request path so you can tell at
 * a glance *where* a problem is:
 *
 *   Edge (CloudFront) — requests, 4xx/5xx rate, cache hit ratio, origin latency
 *   Load balancer (ALB) — request count, target 2xx/4xx/5xx, response-time
 *                          percentiles, healthy/unhealthy hosts, connection errors
 *   Compute (ECS/Fargate) — CPU and memory utilization
 *
 * CloudFront metrics are always Global/us-east-1. ALB + ECS metrics live in the
 * deployment region (this construct's region). The ALB/ECS sections render only
 * when their identifiers are supplied, because ECS Express provisions those
 * resources outside CDK — see the prop docs for where each value comes from.
 *
 * Project-agnostic; pair with `applyTags()` for standard tags.
 */
export class EcsExpressDashboard extends Construct {
  public readonly dashboard: cw.Dashboard;

  constructor(scope: Construct, id: string, props: EcsExpressDashboardProps) {
    super(scope, id);

    const period = props.period ?? Duration.minutes(5);

    // Dashboard names allow only alphanumerics, dash and underscore — sanitize
    // since serviceName often defaults to a domain (e.g. 'example.com').
    const rawName = props.dashboardName ?? `${props.serviceName}-ecs-express`;
    const dashboardName = rawName.replace(/[^A-Za-z0-9_-]/g, '-');

    this.dashboard = new cw.Dashboard(this, 'Dashboard', {
      dashboardName,
      defaultInterval: Duration.hours(3),
    });

    // --- Edge: CloudFront (Global / us-east-1) -------------------------------
    const cf = (metricName: string, statistic: string): cw.Metric =>
      new cw.Metric({
        namespace: 'AWS/CloudFront',
        metricName,
        dimensionsMap: { DistributionId: props.distribution.distributionId, Region: 'Global' },
        statistic,
        period,
        region: 'us-east-1',
      });

    this.dashboard.addWidgets(
      new cw.TextWidget({
        markdown: `# ${props.serviceName} — edge → load balancer → compute`,
        width: 24,
        height: 1,
      }),
    );

    this.dashboard.addWidgets(
      new cw.GraphWidget({
        title: 'CloudFront — requests',
        left: [cf('Requests', 'Sum')],
        leftYAxis: { min: 0 },
        width: 12,
        height: 6,
      }),
      new cw.GraphWidget({
        title: 'CloudFront — error rates (%)',
        left: [cf('4xxErrorRate', 'Average'), cf('5xxErrorRate', 'Average')],
        leftYAxis: { min: 0, max: 100 },
        width: 12,
        height: 6,
      }),
    );

    this.dashboard.addWidgets(
      new cw.GraphWidget({
        title: 'CloudFront — cache hit ratio (%)',
        left: [cf('CacheHitRate', 'Average')],
        leftYAxis: { min: 0, max: 100 },
        width: 12,
        height: 6,
      }),
      new cw.GraphWidget({
        title: 'CloudFront — origin latency',
        left: [cf('OriginLatency', 'p50'), cf('OriginLatency', 'p99')],
        leftYAxis: { min: 0 },
        width: 12,
        height: 6,
      }),
    );

    // --- Load balancer: ALB (deployment region) ------------------------------
    if (props.loadBalancerFullName) {
      const lbDims = { LoadBalancer: props.loadBalancerFullName };
      const alb = (metricName: string, statistic: string): cw.Metric =>
        new cw.Metric({
          namespace: 'AWS/ApplicationELB',
          metricName,
          dimensionsMap: lbDims,
          statistic,
          period,
        });

      this.dashboard.addWidgets(
        new cw.GraphWidget({
          title: 'ALB — requests & target responses',
          left: [
            alb('RequestCount', 'Sum'),
            alb('HTTPCode_Target_2XX_Count', 'Sum'),
            alb('HTTPCode_Target_4XX_Count', 'Sum'),
            alb('HTTPCode_Target_5XX_Count', 'Sum'),
            alb('HTTPCode_ELB_5XX_Count', 'Sum'),
          ],
          leftYAxis: { min: 0 },
          width: 12,
          height: 6,
        }),
        new cw.GraphWidget({
          title: 'ALB — target response time (s)',
          left: [
            alb('TargetResponseTime', 'p50'),
            alb('TargetResponseTime', 'p90'),
            alb('TargetResponseTime', 'p99'),
          ],
          leftYAxis: { min: 0 },
          width: 12,
          height: 6,
        }),
      );

      const connErrorsWidget = new cw.GraphWidget({
        title: 'ALB — connections & errors',
        left: [
          alb('ActiveConnectionCount', 'Sum'),
          alb('TargetConnectionErrorCount', 'Sum'),
          alb('RejectedConnectionCount', 'Sum'),
        ],
        leftYAxis: { min: 0 },
        width: props.targetGroupFullName ? 12 : 24,
        height: 6,
      });

      if (props.targetGroupFullName) {
        const hostDims = {
          LoadBalancer: props.loadBalancerFullName,
          TargetGroup: props.targetGroupFullName,
        };
        const host = (metricName: string): cw.Metric =>
          new cw.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName,
            dimensionsMap: hostDims,
            statistic: 'Average',
            period,
          });
        this.dashboard.addWidgets(
          new cw.GraphWidget({
            title: 'ALB — healthy / unhealthy hosts',
            left: [host('HealthyHostCount'), host('UnHealthyHostCount')],
            leftYAxis: { min: 0 },
            width: 12,
            height: 6,
          }),
          connErrorsWidget,
        );
      } else {
        this.dashboard.addWidgets(connErrorsWidget);
      }
    }

    // --- Compute: ECS / Fargate (deployment region) --------------------------
    if (props.ecsClusterName && props.ecsServiceName) {
      const ecsDims = { ClusterName: props.ecsClusterName, ServiceName: props.ecsServiceName };
      const ecs = (metricName: string, statistic: string): cw.Metric =>
        new cw.Metric({
          namespace: 'AWS/ECS',
          metricName,
          dimensionsMap: ecsDims,
          statistic,
          period,
        });

      this.dashboard.addWidgets(
        new cw.GraphWidget({
          title: 'ECS — CPU utilization (%)',
          left: [ecs('CPUUtilization', 'Average'), ecs('CPUUtilization', 'Maximum')],
          leftYAxis: { min: 0, max: 100 },
          width: 12,
          height: 6,
        }),
        new cw.GraphWidget({
          title: 'ECS — memory utilization (%)',
          left: [ecs('MemoryUtilization', 'Average'), ecs('MemoryUtilization', 'Maximum')],
          leftYAxis: { min: 0, max: 100 },
          width: 12,
          height: 6,
        }),
      );
    }
  }
}
