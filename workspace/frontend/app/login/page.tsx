'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, LogIn, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { useI18n } from '@/lib/i18n';

export function safeLoginReturnTo(value: string | null): string {
  if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  try {
    const url = new URL(value, 'http://local.invalid');
    if (url.origin !== 'http://local.invalid' || url.pathname === '/login' || url.pathname.startsWith('/auth/')) return '/';
    return url.pathname + url.search;
  } catch { return '/'; }
}

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const { user, loading, authenticateLocal } = useOpenAgentsAuth();
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const returnTo = safeLoginReturnTo(search.get('returnTo'));

  useEffect(() => { if (!loading && user) router.replace(returnTo); }, [user, loading, router, returnTo]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const name = username.trim();
    if (!name || name.length > 32 || password.length < 6 || password.length > 128) {
      setError(zh ? '用户名需为 1–32 个字符，密码需为 6–128 个字符。' : 'Use a 1–32 character username and a 6–128 character password.');
      return;
    }
    setPending(true); setError('');
    try {
      await authenticateLocal(mode, name, password);
      router.replace(returnTo);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : (zh ? '登录失败，请重试。' : 'Authentication failed. Please retry.'));
    } finally { setPending(false); }
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-5 py-10 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <img src="/logo-black.png" alt="" className="size-10 object-contain dark:hidden" />
          <img src="/logo-white.png" alt="" className="hidden size-10 object-contain dark:block" />
          <h1 className="text-2xl font-semibold">OpenAgents</h1>
        </div>
        <div className="mb-7 grid grid-cols-2 border-b" role="tablist" aria-label={zh ? '账号' : 'Account'}>
          {(['login', 'register'] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={mode === item} disabled={pending} onClick={() => { setMode(item); setError(''); }} className={`h-11 border-b-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring ${mode === item ? 'border-foreground' : 'border-transparent text-muted-foreground'}`}>{item === 'login' ? (zh ? '登录' : 'Sign in') : (zh ? '注册' : 'Register')}</button>)}
        </div>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2"><Label htmlFor="username">{zh ? '用户名' : 'Username'}</Label><Input id="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} maxLength={32} required disabled={pending} /></div>
          <div className="space-y-2"><Label htmlFor="password">{zh ? '密码' : 'Password'}</Label><Input id="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} maxLength={128} required disabled={pending} /></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={pending || loading}>{pending ? <Loader2 className="size-4 animate-spin" /> : mode === 'login' ? <LogIn className="size-4" /> : <UserPlus className="size-4" />}{mode === 'login' ? (zh ? '登录' : 'Sign in') : (zh ? '创建账号' : 'Create account')}</Button>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<div role="status" className="flex min-h-[100dvh] items-center justify-center"><Loader2 className="size-5 animate-spin" /></div>}><LoginForm /></Suspense>;
}
