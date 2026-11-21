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

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
  includeBotGate = false
): Promise<T> {
  const token = localStorage.getItem('pipflow_token');
  const botGate = localStorage.getItem('pipflow_bot_gate');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined)
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (includeBotGate && botGate) headers['x-bot-gate-token'] = botGate;

  const res = await fetch(`${API_BASE}/api${path}`, { ...options, headers });
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

export function getWebSocketUrl(token: string | null): string {
  const configured = import.meta.env.VITE_WS_URL;
  if (configured) {
    return token ? `${configured}?token=${encodeURIComponent(token)}` : configured;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = `${proto}//${window.location.host}/ws`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}
