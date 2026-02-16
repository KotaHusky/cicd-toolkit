// ─── cicd-toolkit: Azure Container Apps infrastructure ──────────────────────
// Deploys a Container Apps environment, a managed identity with OIDC federated
// credentials for GitHub Actions, and a Contributor role assignment.
//
// Usage:
//   az deployment group create \
//     --resource-group <rg> \
//     --template-file infra/main.bicep \
//     --parameters environmentName=aca-env githubRepos='["owner/repo1","owner/repo2"]'

targetScope = 'resourceGroup'

@description('Container Apps environment name')
param environmentName string = 'aca-env'

@description('Azure region (defaults to resource group location)')
param location string = resourceGroup().location

@description('Managed identity name for GitHub Actions OIDC')
param identityName string = 'github-actions-oidc'

@description('GitHub repos to grant OIDC access (e.g. ["owner/repo1","owner/repo2"])')
param githubRepos array

// ─── Container Apps Environment ─────────────────────────────────────────────

resource acaEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {}
}

// ─── Managed Identity for GitHub Actions OIDC ───────────────────────────────

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
}

// Federated credential for each repo — main branch pushes
resource fedCredMain 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = [
  for (repo, i) in githubRepos: {
    name: 'gha-${replace(repo, '/', '-')}-main'
    parent: identity
    properties: {
      issuer: 'https://token.actions.githubusercontent.com'
      subject: 'repo:${repo}:ref:refs/heads/main'
      audiences: ['api://AzureADTokenExchange']
    }
  }
]

// Federated credential for each repo — pull requests
resource fedCredPR 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = [
  for (repo, i) in githubRepos: {
    name: 'gha-${replace(repo, '/', '-')}-pr'
    parent: identity
    properties: {
      issuer: 'https://token.actions.githubusercontent.com'
      subject: 'repo:${repo}:pull_request'
      audiences: ['api://AzureADTokenExchange']
    }
  }
]

// ─── Role Assignment: Contributor on resource group ─────────────────────────

var contributorRoleId = 'b24988ac-6180-42a0-ab88-20f7382dd24c'

resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, identity.id, contributorRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      contributorRoleId
    )
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ─── Outputs ────────────────────────────────────────────────────────────────

@description('Client ID for azure/login action')
output clientId string = identity.properties.clientId

@description('Tenant ID for azure/login action')
output tenantId string = tenant().tenantId

@description('Subscription ID for azure/login action')
output subscriptionId string = subscription().subscriptionId

@description('Container Apps environment name')
output acaEnvironmentName string = acaEnv.name

@description('Container Apps environment default domain')
output acaDefaultDomain string = acaEnv.properties.defaultDomain
