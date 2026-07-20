param baseName string
param location string
param tags object

// LRS + hot: cheapest tier that fits the POC. No hierarchical namespace.
resource account 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: '${baseName}st${uniqueString(resourceGroup().id)}'
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: account
  name: 'default'
  properties: {
    cors: {
      corsRules: [
        {
          // Browser uploads PUT directly to blob storage with a SAS.
          // Origin '*' is acceptable for the POC because every request still
          // requires a short-lived, single-blob SAS; tighten to the web FQDN
          // when a custom domain exists.
          allowedOrigins: ['*']
          allowedMethods: ['GET', 'HEAD', 'PUT', 'OPTIONS']
          allowedHeaders: ['*']
          exposedHeaders: ['*']
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}

resource originals 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'originals'
}

resource artifacts 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'artifacts'
}

resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: account
  name: 'default'
}

resource ingestionQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queueService
  name: 'rag-ingestion'
}

resource poisonQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queueService
  name: 'rag-ingestion-poison'
}

// Lifecycle: clear abandoned upload artifacts; deleted documents keep their
// blobs 30 days, then age out (PLAN.md §3 blob controls).
resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: account
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'age-out-artifacts'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: ['blockBlob'], prefixMatch: ['artifacts/'] }
            actions: {
              baseBlob: { delete: { daysAfterModificationGreaterThan: 180 } }
            }
          }
        }
      ]
    }
  }
}

output accountName string = account.name
