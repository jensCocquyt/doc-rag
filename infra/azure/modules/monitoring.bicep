param baseName string
param location string
param tags object

// Short retention + a hard daily cap keep Log Analytics inside the budget
// (PLAN.md §3 monitoring controls).
resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${baseName}-logs'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: json('0.5') }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${baseName}-appinsights'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    SamplingPercentage: 25
  }
}

output workspaceId string = workspace.id
output appInsightsConnectionString string = appInsights.properties.ConnectionString
