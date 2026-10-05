// Unified API client ensuring all server calls send client identification, auth tokens,
// and handle rate limiting / quota limits consistently.

const TOKEN_KEY = 'ai_doc_auth_token';
const CLIENT_ID_KEY = 'ai_doc_client_id';

declare global {
  interface Window {
    API_BASE_URL?: string;
  }
}

/**
 * Returns the resolved API Base URL.
 * Automatically resolves the backend server URL when running inside the
 * Android APK (WebViewAssetLoader / file scheme) or falls back to relative
 * paths when hosted in a regular web browser.
 */
export function getApiBaseUrl(): string {
  // 1. Build-time environment variable injected by Vite
  const envUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL)
    ? String(import.meta.env.VITE_API_BASE_URL).trim()
    : '';
  if (envUrl && envUrl.startsWith('https://')) {
    return envUrl.replace(/\/$/, '');
  }

  if (typeof window === 'undefined') return '';

  // 2. Explicit global API Base URL (if defined on window)
  if (window.API_BASE_URL && window.API_BASE_URL.startsWith('https://')) {
    return window.API_BASE_URL.replace(/\/$/, '');
  }

  // 3. Query from native Android bridge if available
  if (window.AndroidBridge && typeof (window.AndroidBridge as any).getApiBaseUrl === 'function') {
    try {
      const nativeUrl = (window.AndroidBridge as any).getApiBaseUrl();
      if (nativeUrl && typeof nativeUrl === 'string' && nativeUrl.startsWith('https://')) {
        return nativeUrl.replace(/\/$/, '');
      }
    } catch {
      // ignore
    }
  }

  // 4. Default in regular web browser / cloud preview: use same origin (relative paths)
  return '';
}

export function buildApiUrl(endpoint: string): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  const baseUrl = getApiBaseUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${baseUrl}${cleanEndpoint}`;
}

export function getClientAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  try {
    let clientId = localStorage.getItem(CLIENT_ID_KEY);
    if (!clientId) {
      clientId = `cid_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      localStorage.setItem(CLIENT_ID_KEY, clientId);
    }
    headers['x-client-id'] = clientId;

    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {
    // localStorage might fail in private browsing mode
  }

  return headers;
}

export async function apiFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const defaultHeaders = getClientAuthHeaders();
  const mergedHeaders = {
    ...defaultHeaders,
    ...(options.headers || {}),
  };

  const targetUrl = buildApiUrl(endpoint);

  const response = await fetch(targetUrl, {
    ...options,
    headers: mergedHeaders,
  });

  if (response.status === 429) {
    // Check if it's daily AI limit or rate limit
    try {
      const cloned = response.clone();
      const body = await cloned.json();
      if (body.limitReached || (body.error && body.error.toLowerCase().includes('limit'))) {
        window.dispatchEvent(new CustomEvent('ai_limit_reached'));
      }
    } catch {
      window.dispatchEvent(new CustomEvent('ai_limit_reached'));
    }
  }

  return response;
}
