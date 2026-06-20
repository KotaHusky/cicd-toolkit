/**
 * Public entry point for consuming cicd-toolkit as a library.
 *
 * Apps depend on this via a git reference, e.g. in infra/package.json:
 *   "cicd-toolkit": "github:KotaHusky/cicd-toolkit#v1"
 * then:
 *   import { EcsExpressEdgeStack } from 'cicd-toolkit';
 *
 * Only the reusable CDK stacks/constructs are exported here. The CDK app entry
 * (bin/bootstrap.ts) and GitHub Actions workflows are not part of the library
 * surface.
 */
export { EcsExpressEdgeStack, EcsExpressEdgeStackProps } from './lib/stacks/ecs-express-edge-stack';
export { StaticSiteStack, StaticSiteStackProps } from './lib/stacks/static-site-stack';
export { OidcBootstrapStack, OidcBootstrapStackProps, RepoRole } from './lib/stacks/oidc-bootstrap-stack';
export { applyTags } from './lib/constructs/standard-tags';
export { StaticSiteDashboard, StaticSiteDashboardProps } from './lib/constructs/static-site-dashboard';
export { EcsExpressDashboard, EcsExpressDashboardProps } from './lib/constructs/ecs-express-dashboard';
export {
  EcsExpressObservability,
  EcsExpressObservabilityProps,
  ObservabilityProps,
  ObservabilityTier,
  ResolvedObservability,
  resolveObservability,
} from './lib/constructs/ecs-express-observability';
