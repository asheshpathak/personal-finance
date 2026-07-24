import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError } from '@/lib/api';

export default function Login({ setAuth }: { setAuth: (auth: boolean) => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
    
    try {
      const data = await api.post<{ token: string }>(endpoint, { email, password }, { auth: false });
      localStorage.setItem('token', data.token);
      setAuth(true);
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError) {
        alert(err.message);
        return;
      }
      console.error(err);
      alert('Network error');
    }
  };

  return (
    <div className="relative flex min-h-dvh w-full items-center justify-center px-4 py-8 overflow-hidden">
      {/* Ambient brand glow behind the card. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-gradient-to-br from-grad-from/30 to-grad-to/20 blur-[120px]"
      />

      <div className="relative w-full max-w-md animate-fade-up">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-grad-from to-grad-to shadow-glow">
            <span className="text-2xl font-extrabold leading-none text-white">T</span>
          </div>
          <h1 className="mt-5 text-3xl font-extrabold tracking-tight">
            {isLogin ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isLogin ? 'Log in to pick up where you left off.' : 'Start tracking your money in minutes.'}
          </p>
        </div>

        <Card className="p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full h-12">
              {isLogin ? 'Log in' : 'Sign up'}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              className="font-bold text-primary hover:underline underline-offset-4"
              onClick={() => setIsLogin(!isLogin)}
            >
              {isLogin ? 'Sign up' : 'Log in'}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
