/**
 * Central API client.
 *
 * The base URL comes from VITE_API_URL, which is baked in at build time — Vercel
 * must have it set before the build runs, not after. Falls back to the local
 * backend port so `npm run dev` works with no .env file.
 */
import { toDayKey } from './dates';

const rawBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:5001';

/** Trailing slash trimmed so `${API_URL}/api/x` never produces a double slash. */
export const API_URL = rawBaseUrl.replace(/\/+$/, '');

export const TOKEN_KEY = 'token';

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

// ── Session expiry ──────────────────────────────────────────────────────────
//
// A 401/403 means the token this client is holding is no longer good. That is a
// fact about the whole session, not about the one call that happened to notice
// it — so it is broadcast rather than returned. Without this, every page just
// logs the error and renders its empty state, and you get a fully chromed app
// showing zeroes for a user who is not signed in.

type UnauthorizedHandler = () => void;
const unauthorizedHandlers = new Set<UnauthorizedHandler>();

/** Registers a listener for "this session is no longer valid". Returns an unsubscribe. */
export function onUnauthorized(handler: UnauthorizedHandler): () => void {
  unauthorizedHandlers.add(handler);
  return () => { unauthorizedHandlers.delete(handler); };
}

/**
 * Announce that the session is dead.
 *
 * Guarded so a page firing six parallel requests — all of which 401 — triggers
 * exactly one logout, not six. The latch clears once a valid token is stored
 * again (see `resetUnauthorized`).
 */
let sessionInvalidated = false;

export function notifyUnauthorized(): void {
  if (sessionInvalidated) return;
  sessionInvalidated = true;
  for (const handler of unauthorizedHandlers) {
    try {
      handler();
    } catch (err) {
      console.error(err);
    }
  }
}

/** Called after a successful sign-in so the next expiry is heard again. */
export function resetUnauthorized(): void {
  sessionInvalidated = false;
}

/** The raw stored value, expired or not. For deciding what to do about it. */
export const readStoredToken = (): string | null => localStorage.getItem(TOKEN_KEY);

/**
 * The token to authenticate with, or null.
 *
 * A token we can already see has expired is discarded rather than sent. Sending
 * it anyway produced a pointless 403 on the first request of every page load
 * after an expiry — and that 403 raced the "your session expired" message, so
 * the reader got bounced to the login screen with no explanation at all.
 */
export function getToken(): string | null {
  const token = readStoredToken();
  if (!token) return null;
  if (isTokenExpired(token)) {
    localStorage.removeItem(TOKEN_KEY);
    return null;
  }
  return token;
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    resetUnauthorized();
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

/**
 * Reads the `exp` claim without verifying the signature.
 *
 * This is a UX shortcut, never a security check — the server verifies properly
 * on every request. It exists so an obviously stale token can be discarded at
 * boot instead of rendering the app and then tearing it down a round-trip
 * later. A malformed token is treated as expired.
 */
export function isTokenExpired(token: string | null): boolean {
  if (!token) return true;
  const [, payload] = token.split('.');
  if (!payload) return true;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json) as { exp?: number };
    if (typeof claims.exp !== 'number') return false; // no expiry claim — let the server decide
    // 10s of slack so a token about to lapse mid-flight isn't treated as live.
    return claims.exp * 1000 <= Date.now() + 10_000;
  } catch {
    return true;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  /** Set false for endpoints that must not carry the stored token (login/register). */
  auth?: boolean;
  /** Set false to handle a 401 locally instead of ending the session. */
  signalUnauthorized?: boolean;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signalUnauthorized = true } = options;

  const headers: Record<string, string> = {};

  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  // Which calendar day it is *here*. The server otherwise bills subscriptions
  // on its own UTC day, which flips hours before local midnight across the
  // Americas — posting tomorrow's charge into today's list.
  headers['X-Client-Day'] = toDayKey();

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  // 204s and empty bodies would blow up res.json(), so parse defensively.
  const text = await res.text();
  const payload = text ? safeParse(text) : null;

  if (!res.ok) {
    // 403 counts as well as 401: the auth middleware answers 403 for a token
    // that failed verification, which for this app means expired.
    if (auth && signalUnauthorized && (res.status === 401 || res.status === 403)) {
      notifyUnauthorized();
    }

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
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, options),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
