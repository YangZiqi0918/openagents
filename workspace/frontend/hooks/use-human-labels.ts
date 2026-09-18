'use client';

import { useEffect, useState } from 'react';
import { IS_LOCAL_AUTH } from '@/lib/api-config';
import { useWorkspaceApi } from '@/lib/workspace-api-context';

export function useHumanLabels() {
  const api = useWorkspaceApi();
  const [state, setState] = useState<{ api: typeof api; labels: Record<string, string> }>({ api, labels: {} });

  useEffect(() => {
    if (!IS_LOCAL_AUTH) return;
    let cancelled = false;
    void api.getTeam().then((members) => {
      if (!cancelled) setState({ api, labels: Object.fromEntries(members.map((member) => [member.email, member.username || member.displayName || 'Member'])) });
    }).catch(() => {
      if (!cancelled) setState({ api, labels: {} });
    });
    return () => { cancelled = true; };
  }, [api]);

  return state.api === api ? state.labels : {};
}
