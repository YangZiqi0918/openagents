'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WorkspaceApi } from '@/lib/api';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { WorkspaceProvider } from '@/lib/workspace-context';
import type { Workspace } from '@/lib/types';
import { useI18n } from '@/lib/i18n';
import { LayoutProvider } from '@/components/layout/layout-context';
import { ProjectInternalPage } from './project-internal-page';

export function ProjectPage({ projectId }: { projectId: string }) {
  const { idToken } = useOpenAgentsAuth();
  const router = useRouter();
  const search = useSearchParams();
  const { locale } = useI18n();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!idToken) return;
    let active = true;
    setWorkspace(null); setError('');
    const api = new WorkspaceApi(projectId, '', idToken);
    Promise.all([api.getWorkspace(), api.getMe()]).then(([next]) => {
      if (!active) return;
      if (next.kind !== 'project') throw new Error(locale === 'zh-CN' ? '此地址不是项目。' : 'This address is not a project.');
      setWorkspace(next);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load project'); });
    return () => { active = false; };
  }, [projectId, idToken, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="flex h-full flex-col items-center justify-center gap-4 p-6"><p role="alert" className="text-sm text-destructive">{error}</p><div className="flex gap-2"><Button variant="outline" onClick={() => router.push('/projects')}>{locale === 'zh-CN' ? '项目列表' : 'Projects'}</Button><Button onClick={() => setAttempt((value) => value + 1)}>{locale === 'zh-CN' ? '重试' : 'Retry'}</Button></div></div>;
  if (!workspace || !idToken) return <div role="status" className="flex h-full items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  return <WorkspaceProvider key={workspace.workspaceId} workspaceId={workspace.workspaceId} token={null} bearerToken={idToken} scopeFilter="project"><LayoutProvider embedded><ProjectInternalPage projectScoped projectId={workspace.workspaceId} projectName={workspace.name} onBack={() => router.push('/projects')} initialSessionId={search.get('session') || undefined} initialTab={search.get('tab') === 'plan' || search.get('tab') === 'review' ? search.get('tab') as 'plan' | 'review' : undefined} initialPlanItemId={search.get('item') || undefined} initialReviewTaskId={search.get('task') || undefined} planStorageKey={`oa:project:${workspace.workspaceId}:plan:v1`} /></LayoutProvider></WorkspaceProvider>;
}
