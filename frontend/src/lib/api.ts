/**
 * Central API client.
 *
 * The base URL comes from VITE_API_URL, which is baked in at build time — Vercel
 * must have it set before the build runs, not after. Falls back to the local
 * backend port so `npm run dev` works with no .env file.
 */
const rawBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:5001';

/** Trailing slash trimmed so `${API_URL}/api/x` never produces a double slash. */
export const API_URL = rawBaseUrl.replace(/\/+$/, '');

/** Thrown for any non-2xx response. `body` holds the parsed error payload, if any. */
export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  /** Set false for endpoints that must not carry the stored token (login/register). */
  auth?: boolean;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;

  const headers: Record<string, string> = {};

  if (auth) {
    const token = localStorage.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  // 204s and empty bodies would blow up res.json(), so parse defensively.
  const text = await res.text();
  const payload = text ? safeParse(text) : null;

  if (!res.ok) {
    const message =
      (payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : null) ?? `Request failed with status ${res.status}`;
    throw new ApiError(res.status, message, payload);
  }

  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
