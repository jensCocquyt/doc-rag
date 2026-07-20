# Entra ID authentication setup (Phase 9)

The code is complete behind explicit switches; **nothing is registered in any
Entra tenant yet**. Until you complete the steps below, the app runs in
`AUTH_MODE=poc` (seeded identity, local development and the current POC).

## App registrations (one-time, tenant admin)

```bash
# 1. API app registration — exposes the scope the SPA requests.
API_APP_ID=$(az ad app create --display-name docrag-api --query appId -o tsv)
az ad app update --id "$API_APP_ID" --identifier-uris "api://$API_APP_ID"
# Add a scope named 'access' via the portal (Expose an API → Add a scope)
# or Microsoft Graph; note the full scope id: api://$API_APP_ID/access

# 2. SPA app registration — the React client.
WEB_APP_ID=$(az ad app create --display-name docrag-web \
  --spa-redirect-uris http://localhost:4200 https://<your-web-fqdn> \
  --query appId -o tsv)
# Grant the SPA delegated permission to the API scope (portal: API permissions).
```

## Configuration

API (`.env` / Container Apps env):

```dotenv
AUTH_MODE=entra
ENTRA_TENANT_ID=<directory (tenant) id>
ENTRA_API_AUDIENCE=api://<API_APP_ID>
```

Web (Vite build-time env):

```dotenv
VITE_AUTH_MODE=entra
VITE_ENTRA_CLIENT_ID=<WEB_APP_ID>
VITE_ENTRA_TENANT_ID=<directory (tenant) id>
VITE_ENTRA_API_SCOPE=api://<API_APP_ID>/access
```

## What the code does once enabled

- The web app redirects to Entra login before rendering and attaches a Bearer
  token (MSAL, sessionStorage cache) to every API call.
- The API validates signature (tenant JWKS), issuer, audience and lifetime on
  every request (`libs/auth`); `/health` stays public for container probes.
- Verified subjects map to app users (`users.external_identity_id`); first
  login provisions the user in the app tenant.
- Upload, delete, conversation creation, chat requests and failed
  authentication are audit-logged (ids and outcomes only — no content).

## POC scope notes

- Single-tenant mapping: every verified user of the configured directory
  lands in the seeded app tenant. Multi-tenant mapping (Entra `tid` → app
  tenant) is a follow-up.
- Authorization is tenant-scoped (all tenant members see all tenant
  documents); per-user document ACLs are out of POC scope by design.
