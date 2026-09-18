'use client';

import { Loader2 } from 'lucide-react';
import { MembersPanel } from '@/components/settings/members-panel';
import { useWorkspace } from '@/lib/workspace-context';

export function ProjectMembersPage() {
  const { api, me } = useWorkspace();
  if (!me) return <div role="status" className="flex flex-1 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  return <MembersPanel api={api} me={me} />;
}
