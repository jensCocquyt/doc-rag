param baseName string
param location string
param tags object

@secure()
param administratorPassword string

// Burstable B1ms + 32GB + no HA + 7-day backups: the smallest practical POC
// server (€20-€35/month). Stop it manually for idle periods (PLAN.md §3).
resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: '${baseName}-pg-${uniqueString(resourceGroup().id)}'
  location: location
  tags: tags
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: 'docrag'
    administratorLoginPassword: administratorPassword
    storage: { storageSizeGB: 32 }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
  }
}

// pgvector must be allowlisted before CREATE EXTENSION (the migration does
// the CREATE).
resource extensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: server
  name: 'azure.extensions'
  properties: { value: 'VECTOR', source: 'user-override' }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: 'docrag'
}

// POC access model: Azure-internal traffic only (Container Apps outbound).
// Private endpoints are explicitly out of budget scope.
resource allowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: server
  name: 'allow-azure-services'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

output fqdn string = server.properties.fullyQualifiedDomainName
