'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MessageSquare, RotateCcw, X } from 'lucide-react';
import { ChatInput, type PendingFile } from '@/components/chat/chat-input';
import { ChatMessages } from '@/components/chat/chat-messages';
import { useMessagePolling } from '@/hooks/use-polling';
import { useComposingSignal } from '@/hooks/use-composing-signal';
import { useWorkspaceApi } from '@/lib/workspace-api-context';
import { mergeMessages } from '@/lib/message-merge';
import {
  eventToMessage,
  type WorkspaceAgent,
  type WorkspaceIdentity,
  type WorkspaceMessage,
} from '@/lib/types';
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
  files: PendingFile[];
  uploaded: Map<File, Attachment>;
}

export function ProjectActivityConversation({
  sessionId,
  agents,
  currentUser,
  draft,
  onDraftChange,
  onRead,
  onSending,
  failedSend,
  onFailedSend,
  labels: l,
  readOnly = false,
}: {
  sessionId: string;
  agents: WorkspaceAgent[];
  currentUser: WorkspaceIdentity;
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
  } = useMessagePolling({ sessionId });
  const { notifyFocus, notifyBlur, notifyTyping } =
    useComposingSignal(sessionId);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [inputVersion, setInputVersion] = useState(0);
  const [optimistic, setOptimistic] = useState<WorkspaceMessage[]>([]);
  const [scrollKey, setScrollKey] = useState(0);
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
    } catch (error) {
      if (!alive.current) return;
      setOptimistic((previous) =>
        previous.filter((message) => message.messageId !== optimisticId),
      );
      setSendError(error instanceof Error ? error.message : l.sendFailed);
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

  const displayed = mergeMessages(
    scopedMessages,
    optimistic.filter((message) => message.sessionId === sessionId),
  );
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
        <ChatInput
          key={inputVersion}
          agents={agents}
          draft={draft}
          onDraftChange={changeDraft}
          onFocusChange={(focused) => (focused ? notifyFocus() : notifyBlur())}
          disabled={readOnly || sending || Boolean(failedSend) || !currentUser.name.trim()}
          onSend={(content, mentions, files) => {
            callbacks.current.onDraftChange(content);
            void send({ content, mentions, files, uploaded: new Map() });
          }}
        />
      </div>
    </div>
  );
}
