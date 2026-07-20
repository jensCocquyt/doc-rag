param baseName string
param location string
param tags object

// Basic tier per plan (~€4-€6/month). Admin user disabled: Container Apps
// pull through managed identity with AcrPull.
resource registry 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: '${baseName}acr${uniqueString(resourceGroup().id)}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

output name string = registry.name
output loginServer string = registry.properties.loginServer
