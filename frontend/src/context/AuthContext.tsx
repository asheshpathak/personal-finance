import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  isTokenExpired,
  readStoredToken,
  onUnauthorized,
  resetUnauthorized,
  setToken,
  TOKEN_KEY,
} from '@/lib/api';
import { clearCachedCurrency } from '@/lib/currencyCache';

export interface AuthUser {
  id: string;
  email: string;
  currency: string | null;
}

type Status =
  /** Deciding whether the stored token is real. Nothing app-shaped may render yet. */
  | 'checking'
  | 'authenticated'
  | 'anonymous';

interface AuthContextValue {
  status: Status;
  user: AuthUser | null;
  isAuthenticated: boolean;
  /** True only while the very first token check is in flight. */
  isBootstrapping: boolean;
  /** Records a fresh session after login/register. */
  signIn: (token: string, user?: AuthUser | null) => void;
  /** Ends the session. `reason` surfaces on the login screen. */
  signOut: (reason?: string) => void;
  /** Message explaining an involuntary sign-out, cleared once shown. */
  expiryNotice: string | null;
  clearExpiryNotice: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const SESSION_EXPIRED = 'Your session expired. Please log in again.';
const ACCOUNT_MISSING = 'That account no longer exists. Please log in again.';

/** How many times to re-ask who we are before rendering on an unproven token. */
const BOOT_RETRIES = 2;

/**
 * What the stored token says at first paint, before any network call.
 *
 * The distinction that matters here is "no token" versus "a token that has
 * lapsed". Both end at the login screen, but only one of them owes the reader
 * an explanation — landing on a login form after a reload, with no word about
 * why, reads as the app having logged you out for no reason.
 */
function initialSession(): { status: Status; notice: string | null } {
  const token = readStoredToken();
  if (!token) return { status: 'anonymous', notice: null };
  // An obviously-stale token is discarded synchronously, so a returning user
  // with a week-old session never sees a flash of the app shell.
  if (isTokenExpired(token)) return { status: 'anonymous', notice: SESSION_EXPIRED };
  return { status: 'checking', notice: null };
}

/**
 * The single source of truth for "is anyone signed in".
 *
 * Before this, `App` read localStorage once at mount and never looked again, so
 * an expired token produced a fully rendered dashboard whose every request was
 * failing — an app full of zeroes for a user who was already logged out. Three
 * things fix that, and all three live here:
 *
 *  1. the stored token is *validated* at boot before anything renders;
 *  2. any 401/403 from anywhere in the app tears the session down immediately;
 *  3. signing out in one tab signs out the others.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [initial] = useState(initialSession);
  const [status, setStatus] = useState<Status>(initial.status);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [expiryNotice, setExpiryNotice] = useState<string | null>(initial.notice);

  // A token already known to be dead is purged rather than left in storage,
  // where the next request would still attach it.
  useEffect(() => {
    if (initial.notice) {
      setToken(null);
      clearCachedCurrency();
    }
  }, [initial.notice]);

  /** Whether a session was ever established, so an expiry can be explained. */
  const hadSessionRef = useRef(false);

  const signOut = useCallback((reason?: string) => {
    setToken(null);
    // Otherwise the next account signing in on this device would briefly see
    // the previous one's currency.
    clearCachedCurrency();
    setUser(null);
    setStatus('anonymous');
    // Always assigned, never only-on-reason: a deliberate log-out after an
    // expiry must not leave the old "your session expired" message on screen.
    setExpiryNotice(reason ?? null);
  }, []);

  const signIn = useCallback((token: string, nextUser: AuthUser | null = null) => {
    setToken(token);
    resetUnauthorized();
    hadSessionRef.current = true;
    setUser(nextUser);
    setExpiryNotice(null);
    setStatus('authenticated');
  }, []);

  // ── Boot: prove the stored token before rendering the app ────────────────
  useEffect(() => {
    if (status !== 'checking') return;
    let cancelled = false;
    let timer: number | undefined;

    const verify = (attempt: number) => {
      api
        .get<AuthUser>('/api/auth/me', { signalUnauthorized: false })
        .then(account => {
          if (cancelled) return;
          hadSessionRef.current = true;
          setUser(account);
          setStatus('authenticated');
        })
        .catch(err => {
          if (cancelled) return;
          const httpStatus = (err as { status?: number }).status;

          if (httpStatus === 401 || httpStatus === 403) {
            signOut(hadSessionRef.current ? SESSION_EXPIRED : undefined);
            return;
          }
          if (httpStatus === 404) {
            // The token verifies but the account behind it is gone. Say so —
            // being dropped at a login screen with no explanation reads as a
            // malfunction.
            signOut(ACCOUNT_MISSING);
            return;
          }

          // Anything else is the network or the server being unreachable — a
          // tunnel, a cold start, a momentary 502. The token is still plausibly
          // valid, so retry a couple of times rather than either logging
          // someone out over a blip or giving up on ever learning who they are.
          if (attempt < BOOT_RETRIES) {
            timer = window.setTimeout(() => verify(attempt + 1), 1200 * (attempt + 1));
            return;
          }

          console.error(err);
          hadSessionRef.current = true;
          setStatus('authenticated');
        });
    };

    verify(0);

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [status, signOut]);

  // ── Any 401/403, anywhere, ends the session ──────────────────────────────
  useEffect(
    () =>
      onUnauthorized(() => {
        signOut(hadSessionRef.current ? SESSION_EXPIRED : undefined);
      }),
    [signOut]
  );

  // ── Cross-tab: logging out in one tab logs out the rest ──────────────────
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== TOKEN_KEY) return;
      if (event.newValue) {
        // Another tab signed in. Re-validate rather than trusting the value.
        resetUnauthorized();
        setStatus('checking');
      } else {
        signOut();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [signOut]);

  // ── Catch a token that lapses while the tab sits open ────────────────────
  //
  // A request would catch it too, but only once one is made. On a dashboard
  // left open overnight that could be hours of stale numbers on screen.
  useEffect(() => {
    if (status !== 'authenticated') return;

    const check = () => {
      if (isTokenExpired(readStoredToken())) signOut(SESSION_EXPIRED);
    };
    const interval = window.setInterval(check, 60_000);
    // Coming back to a backgrounded tab is the moment this matters most.
    document.addEventListener('visibilitychange', check);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', check);
    };
  }, [status, signOut]);

  /**
   * Stable identity, deliberately.
   *
   * The login screen clears the notice on unmount via
   * `useEffect(() => () => clearExpiryNotice(), [clearExpiryNotice])`. An
   * inline arrow here gets a new identity every time this provider re-renders —
   * including the render that *sets* the notice — so that effect's cleanup
   * fires immediately and wipes the message before anyone reads it. useCallback
   * with no deps keeps the cleanup tied to unmount, where it belongs.
   */
  const clearExpiryNotice = useCallback(() => setExpiryNotice(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      isAuthenticated: status === 'authenticated',
      isBootstrapping: status === 'checking',
      signIn,
      signOut,
      expiryNotice,
      clearExpiryNotice,
    }),
    [status, user, signIn, signOut, expiryNotice, clearExpiryNotice]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
