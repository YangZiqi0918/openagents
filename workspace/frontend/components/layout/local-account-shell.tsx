'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getPersonalSpace, type PersonalSpace } from '@/lib/account-api';
import { IS_LOCAL_AUTH } from '@/lib/api-config';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { WorkspaceProvider } from '@/lib/workspace-context';
import { useI18n } from '@/lib/i18n';
import { LayoutProvider, useLayout } from './layout-context';
import { Wrapper } from './wrapper';

function PersonalEntry() {
  const { setDraftThreadOpen, openMobileDetail } = useLayout();
  useEffect(() => { setDraftThreadOpen(true); openMobileDetail(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function AccountNavigation() {
  const pathname = usePathname();
  const { viewMode, setViewMode } = useLayout();
  const personalView = useRef(viewMode === 'projects' ? 'threads' : viewMode);
  if (viewMode !== 'projects') personalView.current = viewMode;
  useEffect(() => {
    if (pathname.startsWith('/projects')) setViewMode('projects');
    else if (viewMode === 'projects') setViewMode(personalView.current);
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function LocalAccountShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, idToken, loading } = useOpenAgentsAuth();
  const { locale } = useI18n();
  const [space, setSpace] = useState<PersonalSpace | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const active = IS_LOCAL_AUTH && (pathname === '/' || pathname === '/projects' || pathname.startsWith('/projects/'));
  const accountId = user?.id || user?.email;

  useEffect(() => {
    if (!active || loading || (user && idToken)) return;
    const route = window.location.hash.startsWith('#/') ? window.location.hash.slice(1) : window.location.pathname + window.location.search;
    router.replace(`/login?returnTo=${encodeURIComponent(route)}`);
  }, [active, loading, user, idToken, router]);

  useEffect(() => {
    if (!IS_LOCAL_AUTH || !idToken || !accountId) { setSpace(null); return; }
    let alive = true;
    setSpace(null); setError('');
    getPersonalSpace(idToken).then((next) => { if (alive) setSpace(next); }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Could not load account'); });
    return () => { alive = false; };
  }, [accountId, idToken, attempt]);

  if (!active) return <>{children}</>;
  if (error) return <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background p-6"><p role="alert" className="text-sm text-destructive">{error}</p><Button onClick={() => setAttempt((value) => value + 1)}>{locale === 'zh-CN' ? '重试' : 'Retry'}</Button></div>;
  if (loading || !idToken || !space) return <div role="status" className="flex min-h-[100dvh] items-center justify-center bg-background"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;

  return <WorkspaceProvider key={accountId} workspaceId={space.workspaceId} token={null} bearerToken={idToken} scopeFilter="personal"><LayoutProvider initialView={pathname.startsWith('/projects') ? 'projects' : 'threads'} onNavigate={(mode) => { if (mode === 'projects') router.push('/projects'); else if (pathname !== '/') router.push('/'); }}><PersonalEntry /><AccountNavigation /><Wrapper projectContent={pathname.startsWith('/projects') ? children : undefined} /></LayoutProvider></WorkspaceProvider>;
}
