# Azure deployment (Phase 8)

Explicit Bicep + GitHub Actions with OIDC. **Nothing here runs automatically** —
the [Deploy to Azure](../../.github/workflows/deploy.yml) workflow is manual
(`workflow_dispatch`) and needs the one-time setup below. Expected recurring
cost: €30–€70/month; the deployment includes €80/€100/€120 budget alerts under
the €130 hard maximum (PLAN.md §3).

## One-time setup

```bash
az login
SUBSCRIPTION_ID=$(az account show --query id -o tsv)

# 1. Resource group
az group create --name rg-docrag-poc --location westeurope \
  --tags project=document-chat-rag environment=poc owner=jens cost-center=personal-azure-credit

# 2. Entra application for GitHub OIDC (no long-lived credentials)
APP_ID=$(az ad app create --display-name docrag-github-deploy --query appId -o tsv)
az ad sp create --id "$APP_ID"
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:jensCocquyt/doc-rag:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'

# 3. Grant the app Contributor + RBAC admin on the resource group
az role assignment create --assignee "$APP_ID" --role Contributor \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-docrag-poc"
az role assignment create --assignee "$APP_ID" --role "Role Based Access Control Administrator" \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-docrag-poc"
```

## GitHub secrets

| Secret                  | Value                                  |
| ----------------------- | -------------------------------------- |
| `AZURE_CLIENT_ID`       | `$APP_ID` from above                   |
| `AZURE_TENANT_ID`       | `az account show --query tenantId`     |
| `AZURE_SUBSCRIPTION_ID` | `$SUBSCRIPTION_ID`                     |
| `POSTGRES_PASSWORD`     | a strong generated password            |

Then run the **Deploy to Azure** workflow from the Actions tab.

## What gets deployed

- Storage account (LRS): `originals` + `artifacts` containers, `rag-ingestion`
  + `rag-ingestion-poison` queues, browser-upload CORS, lifecycle rules.
- Azure Container Registry **Basic**; images built with `az acr build` and
  pulled by Container Apps through a user-assigned managed identity (AcrPull —
  no registry passwords).
- Container Apps environment + `web` / `api` / `worker`, all **min replicas
  0**, low explicit max; the worker wakes from zero via a KEDA `azure-queue`
  rule on `rag-ingestion`.
- PostgreSQL Flexible Server **B1ms burstable**, 32 GB, no HA, 7-day backups,
  `azure.extensions=VECTOR`. Stop it manually for idle periods:
  `az postgres flexible-server stop -g rg-docrag-poc -n <server>`.
- Azure OpenAI (optional input): `gpt-4o-mini` + `text-embedding-3-small`
  deployments; with it disabled the apps run with `AI_PROVIDER=fake`.
- Log Analytics (30-day retention, 0.5 GB/day cap) + Application Insights
  (25% sampling).
- Monthly cost budget with actual/forecast alerts.

## Verifying scale-from-zero (acceptance)

```bash
az containerapp replica list -g rg-docrag-poc -n docrag-worker   # expect none when idle
# upload a document through the web app, then within ~1 minute:
az containerapp replica list -g rg-docrag-poc -n docrag-worker   # expect 1 replica
```

## POC shortcuts (documented deviations)

- Storage and PostgreSQL access use connection strings held as Container Apps
  secrets: the SAS-minting code path is account-key based. Moving to managed
  identity + user-delegation SAS is a hardening follow-up.
- Blob CORS allows any origin (each request still needs a scoped SAS);
  restrict to the web FQDN once it is stable.
- The first deployment creates apps before images exist; they heal after the
  `az acr build` pushes complete.
