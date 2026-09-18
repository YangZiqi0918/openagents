'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';
import { WorkspaceProvider, useWorkspace } from '@/lib/workspace-context';
import { requestLocalWorkspaceAccess, type LocalWorkspaceAccess } from '@/lib/local-workspace';
import { useI18n, useT } from '@/lib/i18n';
import { LayoutProvider } from '@/components/layout/layout-context';
import { Wrapper } from '@/components/layout/wrapper';
import { Button } from '@/components/ui/button';

function LocalIdentity() {
  const { currentUser, setUserName } = useWorkspace();
  const t = useT();
  useEffect(() => {
    if (!currentUser.name.trim()) setUserName(t('workspaceGate.guest'));
  }, [currentUser.name, setUserName, t]);
  return null;
}

export function LocalWorkspace({ workspaceId }: { workspaceId?: string }) {
  const router = useRouter();
  const { locale } = useI18n();
  const t = useT();
  const [access, setAccess] = useState<LocalWorkspaceAccess | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setAccess(null);
    setFailed(false);
    requestLocalWorkspaceAccess(workspaceId, controller.signal).then((credentials) => {
      if (controller.signal.aborted) return;
      setAccess(credentials);
      if (!workspaceId) router.replace(`/${encodeURIComponent(credentials.slug)}`);
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [workspaceId, attempt, router]);

  if (failed) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background p-8 text-center">
        <h1 className="text-xl font-semibold">{t('workspaceGate.loadFailedTitle')}</h1>
        <p role="alert" className="max-w-md text-sm text-muted-foreground">
          {locale === 'zh-CN' ? '无法打开本地工作区，请确认本地后端已启动并启用了 LOCAL_MODE。' : 'Could not open the local workspace. Check that the local backend is running with LOCAL_MODE enabled.'}
        </p>
        <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
          <RotateCcw className="size-4" />{t('common.retry')}
        </Button>
      </div>
    );
  }

  if (!access) {
    return <div role="status" className="flex min-h-[100dvh] items-center justify-center bg-background text-sm text-muted-foreground">{t('admin.loading')}</div>;
  }

  return (
    <WorkspaceProvider key={access.workspaceId} workspaceId={access.workspaceId} token={access.token} bearerToken="">
      <LocalIdentity />
      <LayoutProvider><Wrapper /></LayoutProvider>
    </WorkspaceProvider>
  );
}
