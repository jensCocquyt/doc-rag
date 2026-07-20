param baseName string
param location string
param tags object
param logAnalyticsWorkspaceId string
param registryLoginServer string
param registryName string
param storageAccountName string
param postgresFqdn string
@secure()
param postgresPassword string
param apiImage string
param workerImage string
param webImage string
param azureOpenAiResourceName string
@secure()
param azureOpenAiKey string
param appInsightsConnectionString string

var storageConnection = 'DefaultEndpointsProtocol=https;AccountName=${storageAccountName};AccountKey=${listKeys(resourceId('Microsoft.Storage/storageAccounts', storageAccountName), '2023-05-01').keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
var databaseUrl = 'postgresql://docrag:${postgresPassword}@${postgresFqdn}:5432/docrag?sslmode=require'
var useAzureOpenAi = azureOpenAiResourceName != ''

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: last(split(logAnalyticsWorkspaceId, '/'))
}

resource environment_ 'Microsoft.App/managedEnvironments@2024-10-02-preview' = {
  name: '${baseName}-env'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: workspace.properties.customerId
        sharedKey: workspace.listKeys().primarySharedKey
      }
    }
  }
}

// One identity per app keeps RBAC auditable; all three need AcrPull only.
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${baseName}-apps-identity'
  location: location
  tags: tags
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' existing = {
  name: registryName
}

var acrPullRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: acrPullRoleId
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

var commonSecrets = [
  { name: 'database-url', value: databaseUrl }
  { name: 'storage-connection', value: storageConnection }
]
var openAiSecrets = useAzureOpenAi
  ? [{ name: 'azure-openai-key', value: azureOpenAiKey }]
  : []

var commonEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'DATABASE_URL', secretRef: 'database-url' }
  { name: 'AZURE_STORAGE_BLOB_CONNECTION_STRING', secretRef: 'storage-connection' }
  { name: 'AZURE_STORAGE_QUEUE_CONNECTION_STRING', secretRef: 'storage-connection' }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
  { name: 'AI_PROVIDER', value: useAzureOpenAi ? 'azure' : 'fake' }
]
var openAiEnv = useAzureOpenAi
  ? [
      { name: 'AZURE_OPENAI_RESOURCE_NAME', value: azureOpenAiResourceName }
      { name: 'AZURE_OPENAI_API_KEY', secretRef: 'azure-openai-key' }
      { name: 'AZURE_OPENAI_CHAT_DEPLOYMENT', value: 'gpt-4o-mini' }
      { name: 'AZURE_OPENAI_EMBEDDING_DEPLOYMENT', value: 'text-embedding-3-small' }
    ]
  : []

resource api 'Microsoft.App/containerApps@2024-10-02-preview' = {
  name: '${baseName}-api'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    managedEnvironmentId: environment_.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
      }
      registries: [
        { server: registryLoginServer, identity: identity.id }
      ]
      secrets: concat(commonSecrets, openAiSecrets)
    }
    template: {
      containers: [
        {
          name: 'api'
          image: '${registryLoginServer}/${apiImage}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(commonEnv, openAiEnv)
          probes: [
            {
              type: 'Readiness'
              httpGet: { path: '/health', port: 3000 }
              initialDelaySeconds: 5
              periodSeconds: 15
            }
          ]
        }
      ]
      // Scale to zero (PLAN.md §3); low explicit maximum.
      scale: {
        minReplicas: 0
        maxReplicas: 2
        rules: [
          {
            name: 'http'
            http: { metadata: { concurrentRequests: '20' } }
          }
        ]
      }
    }
  }
  dependsOn: [acrPull]
}

resource worker 'Microsoft.App/containerApps@2024-10-02-preview' = {
  name: '${baseName}-worker'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    managedEnvironmentId: environment_.id
    configuration: {
      registries: [
        { server: registryLoginServer, identity: identity.id }
      ]
      secrets: concat(commonSecrets, openAiSecrets)
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: '${registryLoginServer}/${workerImage}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(commonEnv, openAiEnv)
        }
      ]
      // KEDA azure-queue rule wakes the worker from zero on a message
      // (PLAN.md Phase 8 acceptance: test scale-from-zero with a real message).
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [
          {
            name: 'ingestion-queue'
            custom: {
              type: 'azure-queue'
              metadata: {
                queueName: 'rag-ingestion'
                queueLength: '1'
                accountName: storageAccountName
              }
              auth: [
                { secretRef: 'storage-connection', triggerParameter: 'connection' }
              ]
            }
          }
        ]
      }
    }
  }
  dependsOn: [acrPull]
}

resource web 'Microsoft.App/containerApps@2024-10-02-preview' = {
  name: '${baseName}-web'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    managedEnvironmentId: environment_.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
      }
      registries: [
        { server: registryLoginServer, identity: identity.id }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: '${registryLoginServer}/${webImage}'
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: [
            // nginx proxies /documents|/conversations|/health here, keeping
            // the browser same-origin (no API CORS surface).
            { name: 'API_URL', value: 'https://${api.properties.configuration.ingress.fqdn}' }
          ]
        }
      ]
      scale: { minReplicas: 0, maxReplicas: 2 }
    }
  }
  dependsOn: [acrPull]
}

output webUrl string = 'https://${web.properties.configuration.ingress.fqdn}'
output apiUrl string = 'https://${api.properties.configuration.ingress.fqdn}'
