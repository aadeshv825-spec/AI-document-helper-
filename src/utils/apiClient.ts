// Unified API client for web + Android app.
// Android WebView must use the deployed backend URL instead of relative /api paths.

const TOKEN_KEY = 'ai_doc_auth_token';
const CLIENT_ID_KEY = 'ai_doc_client_id';

// The backend URL is set at build time with VITE_API_BASE_URL (the
// production Cloud Run / custom domain URL). Android release builds
// refuse to build without it (see vite.config.ts). When it is not set
// (web build served by the same server), requests use relative /api
// paths on the current origin.
const API_BASE_URL = String(
  (import.meta as any).env?.VITE_API_BASE_URL || ''
).replace(/\/$/, '');

function buildApiUrl(endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) {
    return endpoint;
  }

  const normalizedEndpoint = endpoint.startsWith('/')
    ? endpoint
    : `/${endpoint}`;

  return `${API_BASE_URL}${normalizedEndpoint}`;
}

export function getClientAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  try {
    let clientId = localStorage.getItem(CLIENT_ID_KEY);

    if (!clientId) {
      clientId = `cid_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 9)}`;

      localStorage.setItem(CLIENT_ID_KEY, clientId);
    }

    headers['x-client-id'] = clientId;

    const token = localStorage.getItem(TOKEN_KEY);

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {
    // Ignore localStorage errors.
  }

  return headers;
}

export async function apiFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const defaultHeaders = getClientAuthHeaders();

  const mergedHeaders: Record<string, string> = {
    ...defaultHeaders,
    ...(options.headers as Record<string, string> | undefined),
  };

  const url = buildApiUrl(endpoint);

  const response = await fetch(url, {
    ...options,
    headers: mergedHeaders,
  });

  if (response.status === 429) {
    try {
      const cloned = response.clone();
      const body = await cloned.json();

      if (
        body.limitReached ||
        (body.error &&
          body.error.toLowerCase().includes('limit'))
      ) {
        window.dispatchEvent(
          new CustomEvent('ai_limit_reached')
        );
      }
    } catch {
      window.dispatchEvent(
        new CustomEvent('ai_limit_reached')
      );
    }
  }

  return response;
}
