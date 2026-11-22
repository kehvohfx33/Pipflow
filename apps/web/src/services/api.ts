const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  public code?: string;
  public status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getCookieValue(name: string): string {
  if (typeof document === 'undefined') return '';
  const pairs = document.cookie ? document.cookie.split(';') : [];
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    if (pair.slice(0, idx).trim() === name) {
      return decodeURIComponent(pair.slice(idx + 1).trim());
    }
  }
  return '';
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
  includeBotGate = false
): Promise<T> {
  const botGate = localStorage.getItem('pipflow_bot_gate');
  const method = String(options.method || 'GET').toUpperCase();
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined)
  };
  if (isMutation) {
    headers['X-Requested-With'] = 'XMLHttpRequest';
    const csrf = getCookieValue('pf_csrf');
    if (csrf) {
      headers['X-CSRF-Token'] = csrf;
    }
  }
  if (includeBotGate && botGate) headers['x-bot-gate-token'] = botGate;

  const res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    credentials: 'include',
    headers
  });
  const text = await res.text();
  const looksLikeHtml = text.trimStart().startsWith('<');

  let data: Record<string, unknown> = {};
  if (!looksLikeHtml) {
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text || `HTTP ${res.status}` };
    }
  } else {
    data = {
      error:
        res.status === 502 || res.status === 503 || res.status === 504
          ? `Server returned HTTP ${res.status} (Service Unavailable). The trading gateway is starting up or temporarily unreachable.`
          : `Unexpected server response (HTTP ${res.status}). Please retry in a moment.`
    };
  }

  if (!res.ok || looksLikeHtml) {
    throw new ApiError(
      String(data.error || `Request failed with status ${res.status}`),
      res.status,
      typeof data.code === 'string' ? data.code : undefined
    );
  }
  return data as T;
}

export function getWebSocketUrl(): string {
  const configured = import.meta.env.VITE_WS_URL;
  if (configured) {
    return configured;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}
