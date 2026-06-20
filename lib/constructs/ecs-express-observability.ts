import { Duration } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as cwactions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { EcsExpressDashboard } from './ecs-express-dashboard';

export type ObservabilityTier = 'dev' | 'prod';

/**
 * Opt-in observability for an ECS Express app behind CloudFront. Absent on the
 * edge stack = nothing is created (dashboards/alarms/logs are all opt-in).
 *
 * `tier` sets defaults; any field can be overridden:
 *   dev  — dashboard, 1-week log retention. Cheap and quiet.
 *   prod — dashboard, 90-day retention, CloudFront access logs, alarms -> SNS,
 *          and X-Ray (the X-Ray flag is consumed by the app/bootstrap side; the
 *          edge stack only records it — ECS Express can't run a tracing sidecar,
 *          so tracing is daemonless in-app).
 */
export interface ObservabilityProps {
  tier: ObservabilityTier;
  /** CloudWatch dashboard. Default: true. */
  dashboard?: boolean;
  /** CloudWatch alarms (ALB 5xx/p99/unhealthy + ECS CPU/mem) -> SNS. Default: prod. */
  alarms?: boolean;
  /** CloudFront standard access logs (CDK auto-provisions the log bucket). Default: prod. */
  accessLogs?: boolean;
  /** Distributed tracing (X-Ray). Consumed by the app + bootstrap task role, not
   *  the edge stack. Default: prod. */
  xray?: boolean;
  /** Retention applied to the ECS Express log group (see ecsLogGroupName).
   *  Default: dev=1 week, prod=3 months. */
  logRetention?: logs.RetentionDays;
  /** Email subscribed to the alarm SNS topic (optional). */
  alarmEmail?: string;
  /** ECS Express log group name to apply retention to (Express owns the group,
   *  so retention is set via a small custom resource). */
  ecsLogGroupName?: string;
}

export interface ResolvedObservability {
  tier: ObservabilityTier;
  dashboard: boolean;
  alarms: boolean;
  accessLogs: boolean;
  xray: boolean;
  logRetention: logs.RetentionDays;
  alarmEmail?: string;
  ecsLogGroupName?: string;
}

/** Apply tier defaults, letting explicit fields win. */
export function resolveObservability(o: ObservabilityProps): ResolvedObservability {
  const prod = o.tier === 'prod';
  return {
    tier: o.tier,
    dashboard: o.dashboard ?? true,
    alarms: o.alarms ?? prod,
    accessLogs: o.accessLogs ?? prod,
    xray: o.xray ?? prod,
    logRetention:
      o.logRetention ?? (prod ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_WEEK),
    alarmEmail: o.alarmEmail,
    ecsLogGroupName: o.ecsLogGroupName,
  };
}

export interface EcsExpressObservabilityProps {
  config: ResolvedObservability;
  serviceName: string;
  distribution: cloudfront.IDistribution;
  dashboardName?: string;
  /** ALB dimension `app/<name>/<id>` — enables ALB widgets + alarms. */
  loadBalancerFullName?: string;
  /** Target group dimension `targetgroup/<name>/<id>` — enables host-health. */
  targetGroupFullName?: string;
  /** ECS cluster name (default `default`) — enables compute widgets + alarms. */
  ecsClusterName?: string;
  /** ECS service name — enables compute widgets + alarms. */
  ecsServiceName?: string;
}

/**
 * Builds the dashboard + alarms + log retention for one ECS Express app.
 * CloudFront access logging is configured on the Distribution itself (in the
 * edge stack, since it must be set at creation), driven by the same config.
 */
export class EcsExpressObservability extends Construct {
  public readonly dashboard?: EcsExpressDashboard;
  public readonly alarmTopic?: sns.Topic;
  public readonly alarms: cw.Alarm[] = [];

  constructor(scope: Construct, id: string, props: EcsExpressObservabilityProps) {
    super(scope, id);
    const { config } = props;

    if (config.dashboard) {
      this.dashboard = new EcsExpressDashboard(this, 'Dashboard', {
        distribution: props.distribution,
        serviceName: props.serviceName,
        dashboardName: props.dashboardName,
        loadBalancerFullName: props.loadBalancerFullName,
        targetGroupFullName: props.targetGroupFullName,
        ecsClusterName: props.ecsClusterName,
        ecsServiceName: props.ecsServiceName,
      });
    }

    // Retention on the ECS Express-owned log group (foreign resource).
    if (config.ecsLogGroupName) {
      new AwsCustomResource(this, 'LogRetention', {
        onUpdate: {
          service: 'CloudWatchLogs',
          action: 'putRetentionPolicy',
          parameters: {
            logGroupName: config.ecsLogGroupName,
            retentionInDays: config.logRetention,
          },
          physicalResourceId: PhysicalResourceId.of(`retention-${config.ecsLogGroupName}`),
        },
        policy: AwsCustomResourcePolicy.fromSdkCalls({
          resources: AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
        installLatestAwsSdk: false,
      });
    }

    if (config.alarms) {
      this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
        displayName: `${props.serviceName} alarms`,
      });
      if (config.alarmEmail) {
        this.alarmTopic.addSubscription(new subs.EmailSubscription(config.alarmEmail));
      }
      const action = new cwactions.SnsAction(this.alarmTopic);

      if (props.loadBalancerFullName) {
        const lbDims = { LoadBalancer: props.loadBalancerFullName };
        const albMetric = (metricName: string, statistic: string): cw.Metric =>
          new cw.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName,
            dimensionsMap: lbDims,
            statistic,
            period: Duration.minutes(5),
          });

        this.alarms.push(
          new cw.Alarm(this, 'Alb5xx', {
            alarmDescription: `${props.serviceName}: ALB target 5xx`,
            metric: albMetric('HTTPCode_Target_5XX_Count', 'Sum'),
            threshold: 10,
            evaluationPeriods: 1,
            comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cw.TreatMissingData.NOT_BREACHING,
          }),
          new cw.Alarm(this, 'AlbLatencyP99', {
            alarmDescription: `${props.serviceName}: ALB p99 target response time > 3s`,
            metric: albMetric('TargetResponseTime', 'p99'),
            threshold: 3,
            evaluationPeriods: 3,
            comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cw.TreatMissingData.NOT_BREACHING,
          }),
        );

        if (props.targetGroupFullName) {
          this.alarms.push(
            new cw.Alarm(this, 'AlbUnhealthyHosts', {
              alarmDescription: `${props.serviceName}: unhealthy targets`,
              metric: new cw.Metric({
                namespace: 'AWS/ApplicationELB',
                metricName: 'UnHealthyHostCount',
                dimensionsMap: {
                  LoadBalancer: props.loadBalancerFullName,
                  TargetGroup: props.targetGroupFullName,
                },
                statistic: 'Maximum',
                period: Duration.minutes(1),
              }),
              threshold: 1,
              evaluationPeriods: 3,
              comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
              treatMissingData: cw.TreatMissingData.NOT_BREACHING,
            }),
          );
        }
      }

      if (props.ecsClusterName && props.ecsServiceName) {
        const ecsDims = { ClusterName: props.ecsClusterName, ServiceName: props.ecsServiceName };
        const ecsAlarm = (id2: string, metricName: string, label: string): cw.Alarm =>
          new cw.Alarm(this, id2, {
            alarmDescription: `${props.serviceName}: ${label} > 85%`,
            metric: new cw.Metric({
              namespace: 'AWS/ECS',
              metricName,
              dimensionsMap: ecsDims,
              statistic: 'Average',
              period: Duration.minutes(5),
            }),
            threshold: 85,
            evaluationPeriods: 3,
            comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cw.TreatMissingData.NOT_BREACHING,
          });
        this.alarms.push(
          ecsAlarm('EcsCpuHigh', 'CPUUtilization', 'CPU'),
          ecsAlarm('EcsMemHigh', 'MemoryUtilization', 'memory'),
        );
      }

      for (const alarm of this.alarms) alarm.addAlarmAction(action);
    }
  }
}
