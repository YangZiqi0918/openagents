'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { WorkspaceApi } from '@/lib/api';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

export function LegacyProjectRedirect({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const { idToken, loading } = useOpenAgentsAuth();
  const { locale } = useI18n();
  const [error, setError] = useState('');
  useEffect(() => {
    if (loading) return;
    if (!idToken) { router.replace(`/login?returnTo=${encodeURIComponent(`/${workspaceId}`)}`); return; }
    let alive = true;
    new WorkspaceApi(workspaceId, '', idToken).getWorkspace().then((workspace) => {
      if (alive) router.replace(workspace.kind === 'personal' ? '/' : `/projects/${encodeURIComponent(workspace.workspaceId)}`);
    }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Could not open project'); });
    return () => { alive = false; };
  }, [workspaceId, idToken, loading, router]);
  return <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background p-6">{error ? <><p role="alert" className="text-sm text-destructive">{error}</p><Button onClick={() => router.replace('/projects')}>{locale === 'zh-CN' ? '项目列表' : 'Projects'}</Button></> : <Loader2 role="status" className="size-5 animate-spin text-muted-foreground" />}</div>;
}
