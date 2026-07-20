/**
 * Frontend auth wiring (PLAN.md Phase 9). VITE_AUTH_MODE=poc (default) keeps
 * the seeded identity flow — no login. VITE_AUTH_MODE=entra requires the
 * Entra app registrations documented in docs/entra-setup.md and makes every
 * API call carry a Bearer token acquired through MSAL.
 */
import {
  PublicClientApplication,
  type AuthenticationResult,
} from '@azure/msal-browser';

export const authMode = (import.meta.env['VITE_AUTH_MODE'] ?? 'poc') as
  | 'poc'
  | 'entra';

const clientId = import.meta.env['VITE_ENTRA_CLIENT_ID'] as string | undefined;
const tenantId = import.meta.env['VITE_ENTRA_TENANT_ID'] as string | undefined;
const apiScope = import.meta.env['VITE_ENTRA_API_SCOPE'] as string | undefined;

export const msalInstance =
  authMode === 'entra' && clientId && tenantId
    ? new PublicClientApplication({
        auth: {
          clientId,
          authority: `https://login.microsoftonline.com/${tenantId}`,
          redirectUri: window.location.origin,
        },
        cache: { cacheLocation: 'sessionStorage' },
      })
    : null;

async function acquireToken(): Promise<string | null> {
  if (!msalInstance || !apiScope) return null;
  const account = msalInstance.getAllAccounts()[0];
  if (!account) return null;
  try {
    const result: AuthenticationResult =
      await msalInstance.acquireTokenSilent({ scopes: [apiScope], account });
    return result.accessToken;
  } catch {
    await msalInstance.acquireTokenRedirect({ scopes: [apiScope] });
    return null;
  }
}

/** fetch that attaches the Bearer token in entra mode; plain fetch in poc. */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  if (authMode !== 'entra') return fetch(input, init);
  const token = await acquireToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export async function ensureSignedIn(): Promise<void> {
  if (!msalInstance) return;
  await msalInstance.initialize();
  await msalInstance.handleRedirectPromise();
  if (msalInstance.getAllAccounts().length === 0 && apiScope) {
    await msalInstance.loginRedirect({ scopes: [apiScope] });
  }
}
