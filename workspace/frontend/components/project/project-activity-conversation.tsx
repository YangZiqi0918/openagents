'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, Bell, BellOff, Loader2, MessageSquare, RotateCcw, X } from 'lucide-react';
import { ChatInput, type PendingFile } from '@/components/chat/chat-input';
import { ChatMessages } from '@/components/chat/chat-messages';
import { useMessagePolling } from '@/hooks/use-polling';
import { useComposingSignal } from '@/hooks/use-composing-signal';
import { useWorkspaceApi } from '@/lib/workspace-api-context';
import { mergeMessages } from '@/lib/message-merge';
import { isProjectTerminalStatus, projectWaitingState, visibleProjectMessages } from './project-waiting-state';
import {
  eventToMessage,
  type WorkspaceAgent,
  type WorkspaceIdentity,
  type WorkspaceMessage,
  type TeamMember,
} from '@/lib/types';
import { IS_LOCAL_AUTH } from '@/lib/api-config';
import type { activityLabels } from './project-activity-model';

type Attachment = {
  fileId: string;
  filename: string;
  contentType: string;
  url: string;
};
export interface ActivitySend {
  content: string;
  mentions: string[];
  selectedAgentNames: string[];
  files: PendingFile[];
  uploaded: Map<File, Attachment>;
}

export function ProjectActivityConversation({
  workspaceId,
  sessionId,
  agents,
  projectAgents,
  participantNames,
  workflowMode,
  onRosterChange,
  currentUser,
  humanMembers,
  membersError,
  onRetryMembers,
  draft,
  onDraftChange,
  onRead,
  onSending,
  failedSend,
  onFailedSend,
  labels: l,
  readOnly = false,
}: {
  workspaceId: string;
  sessionId: string;
  agents: WorkspaceAgent[];
  projectAgents: WorkspaceAgent[];
  participantNames: string[];
  workflowMode: boolean;
  onRosterChange: () => Promise<void>;
  currentUser: WorkspaceIdentity;
  humanMembers: TeamMember[] | null;
  membersError: boolean;
  onRetryMembers: () => void;
  draft: string;
  onDraftChange: (text: string) => void;
  onRead: () => void;
  onSending: (sending: boolean) => void;
  failedSend?: ActivitySend;
  onFailedSend: (send: ActivitySend | undefined) => void;
  labels: ReturnType<typeof activityLabels>;
  readOnly?: boolean;
}) {
  const workspaceApi = useWorkspaceApi();
  const {
    messages,
    loading,
    forceRefresh,
    generation,
    loadOlder,
    hasOlder,
    loadingOlder,
    error: pollingError,
  } = useMessagePolling({ sessionId, includeThinkingHistory: true });
  const { notifyFocus, notifyBlur, notifyTyping } =
    useComposingSignal(sessionId);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [inputVersion, setInputVersion] = useState(0);
  const [optimistic, setOptimistic] = useState<WorkspaceMessage[]>([]);
  const [scrollKey, setScrollKey] = useState(0);
  const [waitingClock, setWaitingClock] = useState(() => Date.now());
  const [terminalEvidence, setTerminalEvidence] = useState<{
    workspaceId: string; sessionId: string; triggerId: string; message: WorkspaceMessage;
  } | null>(null);
  const [mentionTriggerKey, setMentionTriggerKey] = useState(0);
  const [workflowStep, setWorkflowStep] = useState<{ loaded: boolean; running: boolean; agent: string | null }>({ loaded: false, running: false, agent: null });
  const [following, setFollowing] = useState<boolean | null>(null);
  const [subscriptionError, setSubscriptionError] = useState(false);
  const [subscriptionBusy, setSubscriptionBusy] = useState(false);
  const alive = useRef(true);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const callbacks = useRef({ onDraftChange, onFailedSend, onSending, onRead });
  callbacks.current = { onDraftChange, onFailedSend, onSending, onRead };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
      callbacks.current.onSending(false);
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setWaitingClock(Date.now()), 5_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!IS_LOCAL_AUTH || !workflowMode) {
      setWorkflowStep({ loaded: true, running: false, agent: null });
      return;
    }
    setWorkflowStep({ loaded: false, running: false, agent: null });
    let active = true;
    const controller = new AbortController();
    const loadStep = async () => {
      try {
        const path = `/v1/workspaces/${encodeURIComponent(workspaceId)}/channels/${encodeURIComponent(sessionId)}`;
        const response = await workspaceApi.fetchResource(path, { signal: controller.signal });
        const body = await response.json() as { data: { workflowRunning: boolean; activeWorkflowStepAgent: string | null } };
        if (active) setWorkflowStep({ loaded: true, running: body.data.workflowRunning, agent: body.data.activeWorkflowStepAgent });
      } catch {
        if (active) setWorkflowStep({ loaded: false, running: true, agent: null });
      }
    };
    void loadStep();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadStep();
    }, 5_000);
    window.addEventListener('focus', loadStep);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', loadStep);
    };
  }, [workspaceApi, workspaceId, sessionId, workflowMode]);

  const subscriptionPath = `/v1/workspaces/${encodeURIComponent(workspaceId)}/channels/${encodeURIComponent(sessionId)}/subscription`;
  const loadSubscription = useCallback(async (signal?: AbortSignal) => {
    if (!IS_LOCAL_AUTH) return;
    try {
      const response = await workspaceApi.fetchResource(subscriptionPath, { signal });
      const json = await response.json() as { data: { following: boolean } };
      if (!signal?.aborted && alive.current) {
        setFollowing(json.data.following);
        setSubscriptionError(false);
      }
    } catch {
      if (!signal?.aborted && alive.current) setSubscriptionError(true);
    }
  }, [workspaceApi, subscriptionPath]);
  useEffect(() => {
    if (!IS_LOCAL_AUTH) return;
    const abort = new AbortController();
    void loadSubscription(abort.signal);
    return () => abort.abort();
  }, [loadSubscription]);

  const toggleSubscription = async () => {
    if (following === null || subscriptionBusy) return;
    setSubscriptionBusy(true);
    try {
      const response = await workspaceApi.fetchResource(subscriptionPath, {
        method: 'PUT',
        body: JSON.stringify({ following: !following }),
      });
      const json = await response.json() as { data: { following: boolean } };
      if (alive.current) {
        setFollowing(json.data.following);
        setSubscriptionError(false);
      }
    } catch {
      if (alive.current) setSubscriptionError(true);
    } finally {
      if (alive.current) setSubscriptionBusy(false);
    }
  };

  const scopedMessages = useMemo(
    () => messages.filter((message) => message.sessionId === sessionId),
    [messages, sessionId],
  );
  const latestMessageId = scopedMessages[scopedMessages.length - 1]?.messageId;
  useEffect(() => {
    callbacks.current.onRead();
  }, [latestMessageId]);

  const send = async (submission: ActivitySend) => {
    if (readOnly || busy.current || !alive.current) return;
    busy.current = true;
    setSending(true);
    callbacks.current.onSending(true);
    callbacks.current.onFailedSend(submission);
    setSendError('');
    const abort = new AbortController();
    controller.current = abort;
    const optimisticId = `optimistic-${crypto.randomUUID()}`;
    const content =
      submission.content ||
      submission.files.map((item) => item.file.name).join(', ');
    setOptimistic((previous) => [
      ...previous,
      {
        messageId: optimisticId,
        sessionId,
        senderId: currentUser.id,
        senderName: currentUser.name,
        senderType: 'human',
        content,
        mentions: submission.mentions,
        targetAgents: null,
        messageType: 'chat',
        metadata: {},
        createdAt: new Date().toISOString(),
      },
    ]);
    setScrollKey((value) => value + 1);
    try {
      const joined = new Set(participantNames);
      let added = false;
      try {
        for (const name of submission.selectedAgentNames) {
          if (joined.has(name)) continue;
          await workspaceApi.addChannelParticipant(sessionId, name);
          joined.add(name);
          added = true;
        }
      } finally {
        if (added && alive.current) await onRosterChange();
      }
      for (const item of submission.files) {
        if (!alive.current) return;
        if (submission.uploaded.has(item.file)) continue;
        const uploaded = await workspaceApi.uploadFile(item.file, sessionId, {
          signal: abort.signal,
        });
        if (!alive.current) return;
        submission.uploaded.set(item.file, {
          fileId: uploaded.id,
          filename: uploaded.filename,
          contentType: uploaded.contentType,
          url: workspaceApi.getFileUrl(uploaded.id),
        });
      }
      if (!alive.current) return;
      const attachments = Array.from(submission.uploaded.values());
      const event = await workspaceApi.sendMessage(
        sessionId,
        content,
        currentUser.name,
        submission.mentions.length ? submission.mentions : undefined,
        attachments.length ? attachments : undefined,
        currentUser.id,
      );
      if (!alive.current) return;
      const confirmed = eventToMessage(event);
      setOptimistic((previous) => [
        ...previous.filter((message) => message.messageId !== optimisticId),
        confirmed,
      ]);
      callbacks.current.onFailedSend(undefined);
      if (draftRef.current === submission.content)
        callbacks.current.onDraftChange('');
      forceRefresh();
      void loadSubscription();
    } catch (error) {
      if (!alive.current) return;
      setOptimistic((previous) =>
        previous.filter((message) => message.messageId !== optimisticId),
      );
      const reason = error instanceof Error ? error.message : '';
      setSendError(reason.includes('project_mention_agent_not_joined') ? l.agentNotJoined
        : reason.includes('project_mention_agent_offline') ? l.agentOffline
        : reason.includes('project_mention_member_not_found') ? l.memberNotFound
        : reason.includes('project_workflow_step_agent_only') ? l.workflowStepOnly
        : reason || l.sendFailed);
      setInputVersion((value) => value + 1);
    } finally {
      busy.current = false;
      if (alive.current) {
        setSending(false);
        callbacks.current.onSending(false);
      }
    }
  };

  const changeDraft = (text: string) => {
    // ChatInput clears immediately after onSend; commit that clear only on success.
    if (busy.current && text === '') return;
    callbacks.current.onDraftChange(text);
    notifyTyping();
  };

  const confirmedMessages = mergeMessages(
    scopedMessages,
    optimistic.filter((message) => message.sessionId === sessionId),
  );
  const visibleMessages = visibleProjectMessages(confirmedMessages);
  const rawWaiting = projectWaitingState(confirmedMessages, projectAgents, waitingClock, participantNames);
  const waitingMessages = terminalEvidence?.workspaceId === workspaceId &&
    terminalEvidence.sessionId === sessionId && terminalEvidence.triggerId === rawWaiting?.triggerId
    ? mergeMessages(confirmedMessages, [terminalEvidence.message]) : confirmedMessages;
  const waiting = projectWaitingState(waitingMessages, projectAgents, waitingClock, participantNames);
  const pendingTrigger = rawWaiting?.triggerId;
  const pendingAgent = rawWaiting?.agentName;
  useEffect(() => {
    if (!pendingTrigger || !pendingAgent) return;
    let current = true;
    // History deliberately omits status rows. Check only this request's
    // terminal status so a refresh cannot resurrect an already stopped turn.
    const checkTerminal = async () => {
      let before: string | undefined;
      while (current) {
        const result = await workspaceApi.pollEvents({
          channel: sessionId,
          type: 'workspace.message',
          after: pendingTrigger,
          before,
          sort: 'desc',
          limit: 500,
          excludeMessageTypes: ['chat', 'thinking', 'todos'],
        });
        if (!current) return;
        const terminal = result.events.map(eventToMessage)
          .find((message) => isProjectTerminalStatus(message, pendingAgent));
        if (terminal) {
          setTerminalEvidence({ workspaceId, sessionId, triggerId: pendingTrigger, message: terminal });
          return;
        }
        const oldest = result.events.at(-1)?.id;
        if (!result.has_more || !oldest || oldest === before) return;
        before = oldest;
      }
    };
    void checkTerminal().catch(() => {
      // Live message polling still handles stop events if this check fails.
    });
    return () => { current = false; };
  }, [workspaceApi, workspaceId, sessionId, pendingTrigger, pendingAgent]);
  const lastTimestamp = visibleMessages.at(-1)?.createdAt;
  const pendingMessage: WorkspaceMessage | null = waiting ? {
    messageId: `project-loading-${waiting.triggerId}`,
    sessionId,
    senderType: 'agent',
    senderName: waiting.agentName,
    content: '',
    mentions: [],
    targetAgents: null,
    messageType: 'loading',
    metadata: { projectPending: true, waitingPhase: waiting.phase, waitingStatus: l.stillWaiting },
    createdAt: lastTimestamp && Number.isFinite(Date.parse(lastTimestamp))
      ? new Date(Date.parse(lastTimestamp) + 1).toISOString() : new Date(waitingClock).toISOString(),
  } : null;
  const displayed = pendingMessage ? [...visibleMessages, pendingMessage] : visibleMessages;
  return (
    <div
      data-testid="project-activity-conversation"
      data-session-id={sessionId}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      {pollingError && <div role="alert" className="flex items-center gap-2 border-b border-destructive/30 px-4 py-2 text-sm text-destructive"><span className="min-w-0 flex-1 break-words">{l.loadFailed}: {pollingError}</span><button type="button" onClick={forceRefresh} title={l.retry} aria-label={l.retry} className="flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-muted"><RotateCcw className="size-4" /></button></div>}
      {loading && !displayed.length ? (
        <div
          role="status"
          aria-label={l.loading}
          className="flex flex-1 items-center justify-center"
        >
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : displayed.length ? (
        <ChatMessages
          messages={displayed}
          agents={agents}
          showAllSteps={false}
          preserveThinkingHistory
          scrollKey={scrollKey + generation}
          loadOlder={loadOlder}
          hasOlder={hasOlder}
          loadingOlder={loadingOlder}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3 lg:px-8"
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <MessageSquare className="size-7 opacity-40" />
          <p className="text-sm">{l.noMessages}</p>
        </div>
      )}
      {!sending && failedSend && (
        <div
          role="alert"
          className="mx-3 mb-2 flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
        >
          <span className="min-w-0 flex-1 break-words">
            {l.sendFailed}
            {sendError && `: ${sendError}`}
            {failedSend.files.length > 0 &&
              ` (${failedSend.files.map((item) => item.file.name).join(', ')})`}
          </span>
          <button
            type="button"
            title={l.retrySend}
            aria-label={l.retrySend}
            onClick={() => void send(failedSend)}
            className="flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <RotateCcw className="size-4" />
          </button>
          <button
            type="button"
            title={l.dismiss}
            aria-label={l.dismiss}
            onClick={() => onFailedSend(undefined)}
            className="flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      <div className="mx-auto w-full max-w-4xl shrink-0 px-3 pb-3 pt-1 lg:px-5">
        {IS_LOCAL_AUTH && (
          <div className="mb-1 flex min-h-8 items-center gap-1">
            {!readOnly && (
              <button type="button" title={l.mentionMember} aria-label={l.mentionMember}
                onClick={() => { onRetryMembers(); setMentionTriggerKey((value) => value + 1); }}
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                <AtSign className="size-4" />
              </button>
            )}
            <button type="button" onClick={() => void toggleSubscription()}
              title={following ? l.unfollow : l.follow} aria-label={following ? l.unfollow : l.follow}
              disabled={following === null || subscriptionBusy}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40">
              {following ? <Bell className="size-4" /> : <BellOff className="size-4" />}
            </button>
            {subscriptionError && (
              <button type="button" onClick={() => void loadSubscription()} className="text-xs text-destructive hover:underline">
                {l.subscriptionFailed} · {l.retry}
              </button>
            )}
          </div>
        )}
        <ChatInput
          key={inputVersion}
          agents={agents}
          projectMentions={IS_LOCAL_AUTH ? {
            agents: projectAgents,
            participantNames,
            members: humanMembers,
            membersError,
            onRetryMembers,
            workflowRunning: workflowMode && (!workflowStep.loaded || workflowStep.running),
            activeWorkflowStepAgent: workflowStep.agent,
          } : undefined}
          mentionTriggerKey={mentionTriggerKey}
          draft={draft}
          onDraftChange={changeDraft}
          onFocusChange={(focused) => (focused ? notifyFocus() : notifyBlur())}
          disabled={readOnly || sending || Boolean(failedSend) || !currentUser.name.trim()}
          onSend={(content, mentions, files, metadata) => {
            callbacks.current.onDraftChange(content);
            void send({ content, mentions, selectedAgentNames: metadata?.selectedAgentNames || [], files, uploaded: new Map() });
          }}
        />
      </div>
    </div>
  );
}
