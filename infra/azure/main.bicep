// Document Chat RAG — complete POC environment (PLAN.md Phase 8).
// Resource-group scope; create the group first (see infra/azure/README.md).
// Every SKU, scale bound and retention below is explicit and chosen for the
// €130/month hard budget (expected total €30-€70).

@description('Base name used in resource names; keep short and lowercase.')
@minLength(3)
@maxLength(12)
param baseName string = 'docrag'

param location string = resourceGroup().location

@description('PostgreSQL administrator password.')
@secure()
param postgresPassword string

@description('Container image tags to deploy (from ACR).')
param apiImage string
param workerImage string
param webImage string

@description('Deploy an Azure OpenAI account and model deployments.')
param deployAzureOpenAi bool = true

@description('Monthly budget alerts in EUR (PLAN.md §3).')
param budgetAmount int = 130

param tags object = {
  project: 'document-chat-rag'
  environment: 'poc'
  owner: 'jens'
  'cost-center': 'personal-azure-credit'
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: { baseName: baseName, location: location, tags: tags }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: { baseName: baseName, location: location, tags: tags }
}

module registry 'modules/registry.bicep' = {
  name: 'registry'
  params: { baseName: baseName, location: location, tags: tags }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    baseName: baseName
    location: location
    tags: tags
    administratorPassword: postgresPassword
  }
}

module openai 'modules/openai.bicep' = if (deployAzureOpenAi) {
  name: 'openai'
  params: { baseName: baseName, location: location, tags: tags }
}

module containerApps 'modules/container-apps.bicep' = {
  name: 'container-apps'
  params: {
    baseName: baseName
    location: location
    tags: tags
    logAnalyticsWorkspaceId: monitoring.outputs.workspaceId
    registryLoginServer: registry.outputs.loginServer
    registryName: registry.outputs.name
    storageAccountName: storage.outputs.accountName
    postgresFqdn: postgres.outputs.fqdn
    postgresPassword: postgresPassword
    apiImage: apiImage
    workerImage: workerImage
    webImage: webImage
    azureOpenAiResourceName: deployAzureOpenAi ? openai!.outputs.accountName : ''
    azureOpenAiKey: deployAzureOpenAi ? openai!.outputs.key : ''
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
  }
}

module budget 'modules/budget.bicep' = {
  name: 'budget'
  params: { baseName: baseName, amount: budgetAmount }
}

output webUrl string = containerApps.outputs.webUrl
output apiUrl string = containerApps.outputs.apiUrl
output registryLoginServer string = registry.outputs.loginServer
