'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspaceApi } from '@/lib/workspace-api-context';
import { belongsToProject, isProjectCollaborationChannel, projectChannelPrefix } from '@/lib/project-channels';
import { IS_LOCAL_AUTH } from '@/lib/api-config';
import { networkChannelToSession, type WorkspaceSession } from '@/lib/types';
import {
  activityStorageKey,
  readActivityPreferences,
  type ActivityPreferences,
} from './project-activity-model';

export function useProjectActivity(
  workspaceId: string,
  projectId: string,
  userId: string,
  initialSessionId?: string,
) {
  const workspaceApi = useWorkspaceApi();
  const belongs = useCallback((id: string) => IS_LOCAL_AUTH ? isProjectCollaborationChannel(id) : belongsToProject(id, projectId), [projectId]);
  const storageKey = activityStorageKey(workspaceId, projectId, userId);
  const [preferences, setPreferences] = useState<ActivityPreferences>(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(storageKey);
    } catch {
      /* Storage is optional. */
    }
    const next = readActivityPreferences(saved, projectId, IS_LOCAL_AUTH);
    if (initialSessionId && belongs(initialSessionId))
      next.selectedId = initialSessionId;
    return next;
  });
  const preferencesRef = useRef(preferences);
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [storageFailed, setStorageFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const request = useRef(0);
  const operating = useRef(false);

  const persist = useCallback(
    (next: ActivityPreferences) => {
      if (!alive.current) return;
      preferencesRef.current = next;
      setPreferences(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
        setStorageFailed(false);
      } catch {
        setStorageFailed(true);
      }
    },
    [storageKey],
  );

  const select = useCallback(
    (selectedId: string | null) => {
      if (selectedId && !belongs(selectedId)) return;
      const next = preferencesRef.current;
      persist({
        ...next,
        selectedId,
        readAt: selectedId
          ? { ...next.readAt, [selectedId]: Date.now() }
          : next.readAt,
      });
    },
    [persist, belongs],
  );

  const draft = useCallback(
    (id: string, text: string) => {
      if (!belongs(id)) return;
      const next = preferencesRef.current;
      persist({ ...next, drafts: { ...next.drafts, [id]: text } });
    },
    [persist, belongs],
  );

  const markRead = useCallback(
    (id: string) => {
      if (!belongs(id)) return;
      const next = preferencesRef.current;
      persist({ ...next, readAt: { ...next.readAt, [id]: Date.now() } });
    },
    [persist, belongs],
  );

  const refresh = useCallback(async () => {
    if (operating.current) return;
    const version = ++request.current;
    try {
      const discovery = await workspaceApi.discover();
      if (!alive.current || version !== request.current) return;
      const next = discovery.channels
        .map((channel) => networkChannelToSession(channel, workspaceId))
        .filter(
          (session) =>
            belongs(session.sessionId) &&
            session.status === 'active',
        )
        .sort(
          (a, b) =>
            (b.lastEventAt || Date.parse(b.createdAt || '') || 0) -
            (a.lastEventAt || Date.parse(a.createdAt || '') || 0),
        );
      setSessions(next);
      setLoadError(false);
      const selectedId = preferencesRef.current.selectedId;
      if (!selectedId || !next.some((session) => session.sessionId === selectedId))
        if (next[0]) select(next[0].sessionId);
    } catch {
      if (alive.current && version === request.current) setLoadError(true);
    } finally {
      if (alive.current && version === request.current) setLoading(false);
    }
  }, [workspaceApi, belongs, workspaceId, select]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 5_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      alive.current = false;
      request.current += 1;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const operate = async (action: () => Promise<void>) => {
    if (operating.current || !alive.current) return false;
    operating.current = true;
    request.current += 1;
    setBusy(true);
    setOperationError('');
    try {
      await action();
      return alive.current;
    } catch (error) {
      if (alive.current)
        setOperationError(
          error instanceof Error ? error.message : 'Request failed',
        );
      return false;
    } finally {
      operating.current = false;
      if (alive.current) {
        setBusy(false);
        void refresh();
      }
    }
  };

  const create = (title: string, participants: string[] = []) =>
    operate(async () => {
      const name = `${IS_LOCAL_AUTH ? 'chat-' : projectChannelPrefix(projectId)}${crypto.randomUUID()}`;
      const event = await workspaceApi.sendEvent({
        type: 'network.channel.create',
        source: 'human:user',
        target: 'core',
        payload: { name, title, participants },
      });
      if (!alive.current) return;
      const createdName = event.metadata?.channel_name;
      if (typeof createdName !== 'string' || !belongs(createdName))
        throw new Error('Unexpected project channel');
      const session: WorkspaceSession = {
        sessionId: createdName,
        workspaceId,
        title,
        createdBy: 'human:user',
        status: 'active',
        participants,
        master: null,
        starred: false,
        orchestrationMode: 'dynamic',
        orchestrationInstruction: null,
        workflowId: null,
        createdAt: new Date().toISOString(),
        lastEventAt: null,
      };
      setSessions((previous) => [session, ...previous]);
      select(createdName);
    });

  const rename = (id: string, title: string) =>
    operate(async () => {
      if (!belongs(id))
        throw new Error('Invalid project channel');
      await workspaceApi.updateChannel(id, { title });
      if (alive.current)
        setSessions((previous) =>
          previous.map((session) =>
            session.sessionId === id ? { ...session, title } : session,
          ),
        );
    });

  const remove = (id: string) =>
    operate(async () => {
      if (!belongs(id))
        throw new Error('Invalid project channel');
      await workspaceApi.updateChannel(id, { status: 'deleted' });
      if (!alive.current) return;
      setSessions((previous) =>
        previous.filter((session) => session.sessionId !== id),
      );
      const next = preferencesRef.current;
      const { [id]: removedDraft, ...drafts } = next.drafts;
      const { [id]: removedRead, ...readAt } = next.readAt;
      persist({
        selectedId: next.selectedId === id ? null : next.selectedId,
        drafts,
        readAt,
      });
    });

  const participant = (id: string, name: string, add: boolean) =>
    operate(async () => {
      if (!belongs(id))
        throw new Error('Invalid project channel');
      const session = sessions.find((item) => item.sessionId === id);
      if (!session) throw new Error('Invalid project channel');
      const remaining = session.participants.filter((agent) => agent !== name);
      if (!add && session.master === name) {
        await workspaceApi.updateChannel(id, {
          masterAgent: remaining[0] || '',
          ...(remaining.length === 0 && session.orchestrationMode === 'master'
            ? { orchestrationMode: 'dynamic' } : {}),
        });
      }
      if (add) await workspaceApi.addChannelParticipant(id, name);
      else await workspaceApi.removeChannelParticipant(id, name);
      if (alive.current)
        setSessions((previous) =>
          previous.map((session) =>
            session.sessionId === id
              ? {
                  ...session,
                  participants: add
                    ? Array.from(new Set([...session.participants, name]))
                    : session.participants.filter((agent) => agent !== name),
                  master: !add && session.master === name ? remaining[0] || null : session.master,
                  orchestrationMode: !add && session.master === name && remaining.length === 0 && session.orchestrationMode === 'master'
                    ? 'dynamic' : session.orchestrationMode,
                }
              : session,
          ),
        );
    });

  const configure = (
    id: string,
    changes: { master?: string; mode?: string; workflowId?: string | null },
  ) => operate(async () => {
    const session = sessions.find((item) => item.sessionId === id);
    if (!belongs(id) || !session) throw new Error('Invalid project channel');
    if (changes.master && !session.participants.includes(changes.master))
      throw new Error('Agent is not in this conversation');
    const masterAgent = changes.mode === 'master' && !session.master
      ? session.participants[0]
      : changes.master;
    if (changes.mode === 'master' && !masterAgent && !session.master)
      throw new Error('Add an agent before selecting leader mode');
    await workspaceApi.updateChannel(id, {
      ...(masterAgent && { masterAgent }),
      ...(changes.mode && { orchestrationMode: changes.mode }),
      ...(changes.workflowId !== undefined && { workflowId: changes.workflowId }),
    });
    if (alive.current) setSessions((previous) => previous.map((item) => item.sessionId === id
      ? {
          ...item,
          master: masterAgent ?? item.master,
          orchestrationMode: changes.workflowId ? 'workflow' : changes.mode ?? item.orchestrationMode,
          workflowId: changes.workflowId !== undefined ? changes.workflowId : item.workflowId,
        }
      : item));
  });

  return {
    sessions,
    preferences,
    loading,
    loadError,
    operationError,
    storageFailed,
    busy,
    select,
    draft,
    markRead,
    refresh,
    create,
    rename,
    remove,
    participant,
    configure,
  };
}
