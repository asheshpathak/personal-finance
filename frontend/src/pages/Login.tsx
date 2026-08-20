import { useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError } from '@/lib/api';
import { useAuth, type AuthUser } from '@/context/AuthContext';
import { Wordmark } from '@/components/layout/Wordmark';

interface AuthResponse {
  token: string;
  user: AuthUser;
}

export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { signIn, expiryNotice, clearExpiryNotice } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);
    // Acting on the form is the acknowledgement — the notice explained why you
    // were sent here, and it has served its purpose once you start over.
    clearExpiryNotice();
    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';

    try {
      const data = await api.post<AuthResponse>(endpoint, { email, password }, { auth: false });
      // Establishing the session is all this does — the route guard sees the
      // change and redirects, including back to any remembered deep link.
      signIn(data.token, data.user ?? null);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        console.error(err);
        setError("Couldn't reach the server. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const notice = error ?? expiryNotice;

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-[26rem] animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <Wordmark size={52} />
          <h1 className="mt-5 text-title-1">
            {isLogin ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="mt-2 text-subhead text-muted-foreground">
            {isLogin
              ? 'Pick up where you left off.'
              : 'Track, plan and forecast your money — in about three seconds a payment.'}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-card sm:p-7">
          {/* Inline, not an alert() — a native dialog is jarring and unstyled,
              and on iOS it steals focus from the form it interrupted. */}
          {notice && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-2.5 rounded-xl border border-destructive-border bg-destructive-tint px-3.5 py-3 text-footnote"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive-text" />
              <span className="min-w-0 text-foreground">{notice}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" size="block" className="mt-2" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" />
                  {isLogin ? 'Logging in…' : 'Creating account…'}
                </>
              ) : isLogin ? (
                'Log in'
              ) : (
                'Sign up'
              )}
            </Button>
          </form>

          <div className="mt-6 text-center text-subhead text-muted-foreground">
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              className="tactile font-semibold text-primary hover:underline underline-offset-4"
              onClick={() => { setIsLogin(!isLogin); setError(null); clearExpiryNotice(); }}
            >
              {isLogin ? 'Sign up' : 'Log in'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
