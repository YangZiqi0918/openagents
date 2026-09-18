'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import { belongsToProject, projectChannelPrefix } from '@/lib/project-channels';
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
  const storageKey = activityStorageKey(workspaceId, projectId, userId);
  const [preferences, setPreferences] = useState<ActivityPreferences>(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(storageKey);
    } catch {
      /* Storage is optional. */
    }
    const next = readActivityPreferences(saved, projectId);
    if (initialSessionId && belongsToProject(initialSessionId, projectId))
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
      if (selectedId && !belongsToProject(selectedId, projectId)) return;
      const next = preferencesRef.current;
      persist({
        ...next,
        selectedId,
        readAt: selectedId
          ? { ...next.readAt, [selectedId]: Date.now() }
          : next.readAt,
      });
    },
    [persist, projectId],
  );

  const draft = useCallback(
    (id: string, text: string) => {
      if (!belongsToProject(id, projectId)) return;
      const next = preferencesRef.current;
      persist({ ...next, drafts: { ...next.drafts, [id]: text } });
    },
    [persist, projectId],
  );

  const markRead = useCallback(
    (id: string) => {
      if (!belongsToProject(id, projectId)) return;
      const next = preferencesRef.current;
      persist({ ...next, readAt: { ...next.readAt, [id]: Date.now() } });
    },
    [persist, projectId],
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
            belongsToProject(session.sessionId, projectId) &&
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
      if (
        selectedId &&
        !next.some((session) => session.sessionId === selectedId)
      )
        select(null);
    } catch {
      if (alive.current && version === request.current) setLoadError(true);
    } finally {
      if (alive.current && version === request.current) setLoading(false);
    }
  }, [projectId, workspaceId, select]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const interval = setInterval(() => void refresh(), 15_000);
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

  const create = (title: string) =>
    operate(async () => {
      const name = `${projectChannelPrefix(projectId)}${crypto.randomUUID()}`;
      const event = await workspaceApi.sendEvent({
        type: 'network.channel.create',
        source: 'human:user',
        target: 'core',
        payload: { name, title, participants: [] },
      });
      if (!alive.current) return;
      if (event.metadata?.channel_name !== name)
        throw new Error('Unexpected project channel');
      const session: WorkspaceSession = {
        sessionId: name,
        workspaceId,
        title,
        createdBy: 'human:user',
        status: 'active',
        participants: [],
        master: null,
        starred: false,
        orchestrationMode: 'dynamic',
        orchestrationInstruction: null,
        workflowId: null,
        createdAt: new Date().toISOString(),
        lastEventAt: null,
      };
      setSessions((previous) => [session, ...previous]);
      select(name);
    });

  const rename = (id: string, title: string) =>
    operate(async () => {
      if (!belongsToProject(id, projectId))
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
      if (!belongsToProject(id, projectId))
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
      if (!belongsToProject(id, projectId))
        throw new Error('Invalid project channel');
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
                }
              : session,
          ),
        );
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
  };
}
