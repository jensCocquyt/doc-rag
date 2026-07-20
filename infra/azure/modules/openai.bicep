param baseName string
param location string
param tags object

// S0 pay-as-you-go; cost is bounded by the app's token caps and the small
// model choices (PLAN.md §3: €5-€20/month expected).
resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: '${baseName}-openai-${uniqueString(resourceGroup().id)}'
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: '${baseName}-openai-${uniqueString(resourceGroup().id)}'
    publicNetworkAccess: 'Enabled'
  }
}

resource chatDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: account
  name: 'gpt-4o-mini'
  sku: { name: 'GlobalStandard', capacity: 8 }
  properties: {
    model: { format: 'OpenAI', name: 'gpt-4o-mini', version: '2024-07-18' }
  }
}

resource embeddingDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: account
  name: 'text-embedding-3-small'
  sku: { name: 'Standard', capacity: 20 }
  properties: {
    model: { format: 'OpenAI', name: 'text-embedding-3-small', version: '1' }
  }
  dependsOn: [chatDeployment]
}

output accountName string = account.name
#disable-next-line outputs-should-not-contain-secrets // POC: key flows into a Container Apps secret; managed-identity auth for OpenAI is a hardening follow-up.
output key string = account.listKeys().key1
