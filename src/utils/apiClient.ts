// Unified API client ensuring all server calls send client identification, auth tokens,
// and handle rate limiting / quota limits consistently.

const TOKEN_KEY = 'ai_doc_auth_token';
const CLIENT_ID_KEY = 'ai_doc_client_id';

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

  const response = await fetch(endpoint, {
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
