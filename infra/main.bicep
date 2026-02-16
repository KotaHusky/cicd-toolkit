// Azure Container Apps infrastructure
// Deploy: az deployment group create -g <rg> -f infra/main.bicep -p appName=<name> image=<image>

@description('Name of the Container App')
param appName string

@description('Container image to deploy')
param image string

@description('Target port the container listens on')
param targetPort int = 3000

@description('Minimum number of replicas')
param minReplicas int = 1

@description('Azure region (defaults to resource group location)')
param location string = resourceGroup().location

var envName = '${appName}-env'

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: envName
  location: location
  properties: {
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  properties: {
    environmentId: environment.id
    configuration: {
      ingress: {
        external: true
        targetPort: targetPort
      }
    }
    template: {
      containers: [
        {
          name: appName
          image: image
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: minReplicas
      }
    }
  }
}

@description('FQDN of the deployed Container App')
output fqdn string = containerApp.properties.configuration.ingress.fqdn
