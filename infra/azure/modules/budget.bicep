param baseName string
param amount int

// Actual + forecasted alerts at €80/€100/€120 under the €130 hard maximum
// (PLAN.md §3 mandatory budget controls). Emails go to the subscription
// owner; adjust contactEmails after deployment if needed.
resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: '${baseName}-budget'
  properties: {
    category: 'Cost'
    amount: amount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: '2026-08-01'
      endDate: '2028-08-01'
    }
    notifications: {
      actual80: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 62 // €80 of €130
        contactRoles: ['Owner']
        contactEmails: []
      }
      actual100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 77 // €100
        contactRoles: ['Owner']
        contactEmails: []
      }
      forecast120: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 92 // €120
        thresholdType: 'Forecasted'
        contactRoles: ['Owner']
        contactEmails: []
      }
    }
  }
}
