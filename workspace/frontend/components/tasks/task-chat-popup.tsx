'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/responsive-dialog';
import { ChatMessages } from '@/components/chat/chat-messages';
import { ChatInput, type PendingFile } from '@/components/chat/chat-input';
import { useMessagePolling } from '@/hooks/use-polling';
import { useWorkspace } from '@/lib/workspace-context';
import { useWorkspaceApi } from '@/lib/workspace-api-context';
import { toast } from 'sonner';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { useI18n } from '@/lib/i18n';
import type { KanbanTask, TaskSubmissionHistoryEntry, WorkspaceMessage } from '@/lib/types';
import { eventToMessage } from '@/lib/types';
import { mergeMessages } from '@/lib/message-merge';
import { projectWaitingState, visibleProjectMessages } from '@/components/project/project-waiting-state';
import { IS_LOCAL_AUTH } from '@/lib/api-config';

interface TaskChatPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The task's hidden working thread (channel name). */
  sessionId: string;
  taskId: string;
  taskTitle: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  assignee: string | null;
  /** Optional status line under the title, e.g. workflow step progress. */
  subtitle?: string;
  submittedSummary?: string | null;
  submissionHistory?: TaskSubmissionHistoryEntry[];
}

type TaskChannelDetail = { participants: string[]; workflowRunning: boolean; activeWorkflowStepAgent: string | null };
type TaskSubmission = {
  content: string;
  mentions: string[];
  files: PendingFile[];
  uploaded: Map<File, { fileId: string; filename: string; contentType: string; url: string }>;
};

function messagesForCurrentRun(messages: WorkspaceMessage[], runId: string | null | undefined, agentName: string | null | undefined) {
  if (!runId || !agentName) return [];
  const start = messages.findIndex((message) => message.metadata.task_run_id === runId &&
    message.targetAgents?.includes(agentName));
  if (start < 0) return [];
  return messages.slice(start).filter((message) => message.metadata.task_run_id === runId ||
    (message.metadata.task_run_id == null && message.senderType === 'agent' && message.senderName === agentName));
}

export function TaskChatPopup({ open, onOpenChange, sessionId, taskId, taskTitle, description, acceptanceCriteria, assignee, subtitle, submittedSummary, submissionHistory }: TaskChatPopupProps) {
  const { locale } = useI18n();
  const workspaceApi = useWorkspaceApi();
  const { agents, currentUser, canWrite = true, workspace, me } = useWorkspace();
  const workspaceId = workspace?.workspaceId;
  const projectContext = IS_LOCAL_AUTH && workspace?.kind === 'project';
  const [task, setTask] = useState<KanbanTask | null>(null);
  const projectTask = projectContext && Boolean(task?.responsibleUserId);
  const { messages, forceRefresh, generation, loadOlder, hasOlder, loadingOlder, error: pollingError } = useMessagePolling({
    sessionId,
    enabled: open,
    includeThinkingHistory: projectTask,
  });
  const [scrollKey, setScrollKey] = useState(0);
  const [channel, setChannel] = useState<TaskChannelDetail | null>(null);
  const [stateError, setStateError] = useState(false);
  const [waitingClock, setWaitingClock] = useState(() => Date.now());
  const [terminalEvidence, setTerminalEvidence] = useState<{ triggerId: string; sessionId: string; message: WorkspaceMessage } | null>(null);
  const [confirmedMessages, setConfirmedMessages] = useState<WorkspaceMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [inputVersion, setInputVersion] = useState(0);
  const [sending, setSending] = useState(false);
  const [failedSend, setFailedSend] = useState<TaskSubmission | null>(null);
  const [sendError, setSendError] = useState('');
  const busy = useRef(false);
  const requestSeq = useRef(0);
  const scope = useRef(sessionId);
  scope.current = sessionId;

  const refreshTaskState = useCallback(async (signal?: AbortSignal) => {
    if (!projectContext || !workspaceId) return;
    const seq = ++requestSeq.current;
    try {
      const [nextTask, response] = await Promise.all([
        workspaceApi.getTask(taskId),
        workspaceApi.fetchResource(`/v1/workspaces/${encodeURIComponent(workspaceId)}/channels/${encodeURIComponent(sessionId)}`, { signal }),
      ]);
      const body = await response.json() as { data: TaskChannelDetail };
      if (signal?.aborted || scope.current !== sessionId || requestSeq.current !== seq) return;
      if (nextTask.channelName !== sessionId || !Array.isArray(body.data?.participants)) throw new Error('Task channel mismatch');
      setTask(nextTask);
      setChannel(body.data);
      setStateError(false);
    } catch {
      if (signal?.aborted || scope.current !== sessionId || requestSeq.current !== seq) return;
      setTask(null);
      setChannel(null);
      setStateError(true);
    }
  }, [projectContext, sessionId, taskId, workspaceId, workspaceApi]);

  useEffect(() => {
    if (!open || !projectContext) return;
    const controller = new AbortController();
    setTask(null);
    setChannel(null);
    setTerminalEvidence(null);
    void refreshTaskState(controller.signal);
    const onFocus = () => void refreshTaskState(controller.signal);
    const interval = window.setInterval(() => {
      setWaitingClock(Date.now());
      if (document.visibilityState === 'visible') void refreshTaskState(controller.signal);
    }, 5_000);
    window.addEventListener('focus', onFocus);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [open, projectContext, refreshTaskState]);

  const activeRun = task?.status === 'in_progress' && Boolean(task?.activeRunId) && !task?.transferUserId;
  const executable = activeRun &&
    (task?.executionStatus === 'running' || task?.executionStatus === 'in_progress');
  const canResume = activeRun && task?.executionStatus === 'need_input';
  const targetName = task?.workflowId
    ? (channel?.workflowRunning && task.run?.status === 'running' &&
       task.run.stepAssigneeKind === 'agent' && channel.activeWorkflowStepAgent === task.run.stepAssignee
        ? channel.activeWorkflowStepAgent : null)
    : task?.assignee;
  const activeAgents = projectTask && (executable || canResume) && targetName && channel?.participants.includes(targetName)
    ? agents.filter((agent) => agent.agentName === targetName && agent.status === 'online') : [];
  const taskAgents = task?.responsibleUserId === me?.userId ? activeAgents : [];
  const scopedMessages = messages.filter((message) => message.sessionId === sessionId);
  const combined = mergeMessages(scopedMessages, confirmedMessages.filter((message) => message.sessionId === sessionId));
  const visible = projectTask ? visibleProjectMessages(combined) : combined;
  const currentRunMessages = projectTask && executable
    ? messagesForCurrentRun(combined, task.activeRunId, targetName) : [];
  const rawWaiting = executable
    ? projectWaitingState(currentRunMessages, activeAgents, waitingClock, channel?.participants) : null;
  const waitingMessages = terminalEvidence?.sessionId === sessionId && terminalEvidence.triggerId === rawWaiting?.triggerId
    ? mergeMessages(currentRunMessages, [terminalEvidence.message]) : currentRunMessages;
  const waiting = executable
    ? projectWaitingState(waitingMessages, activeAgents, waitingClock, channel?.participants) : null;

  useEffect(() => {
    if (!projectTask || !open || !rawWaiting) return;
    let current = true;
    const { triggerId, agentName } = rawWaiting;
    const checkTerminal = async () => {
      let before: string | undefined;
      while (current) {
        const result = await workspaceApi.pollEvents({
          channel: sessionId, type: 'workspace.message', after: triggerId, before, sort: 'desc', limit: 500,
          excludeMessageTypes: ['chat', 'thinking', 'todos'],
        });
        if (!current) return;
        const terminal = result.events.map(eventToMessage).find((message) =>
          (message.metadata.task_run_id == null || message.metadata.task_run_id === task?.activeRunId) &&
          message.senderType === 'agent' && message.senderName === agentName &&
          (message.messageType === 'error' ||
            /stopped|stopping failed/i.test(message.content) ||
            ['failed', 'error', 'completed', 'done', 'cancelled'].includes(String(message.metadata.status_kind).toLowerCase())));
        if (terminal) {
          setTerminalEvidence({ sessionId, triggerId, message: terminal });
          return;
        }
        const oldest = result.events.at(-1)?.id;
        if (!result.has_more || !oldest || oldest === before) return;
        before = oldest;
      }
    };
    void checkTerminal().catch(() => {});
    return () => { current = false; };
  }, [projectTask, open, rawWaiting?.triggerId, rawWaiting?.agentName, sessionId, task?.activeRunId, workspaceApi]);

  const lastTimestamp = visible.at(-1)?.createdAt;
  const displayed: WorkspaceMessage[] = waiting ? [...visible, {
    messageId: `task-loading-${waiting.triggerId}`, sessionId, senderType: 'agent', senderName: waiting.agentName,
    content: '', mentions: [], targetAgents: null, messageType: 'loading',
    metadata: { projectPending: true, waitingPhase: waiting.phase, waitingStatus: locale === 'zh-CN' ? '仍在等待' : 'Still waiting' },
    createdAt: lastTimestamp && Number.isFinite(Date.parse(lastTimestamp))
      ? new Date(Date.parse(lastTimestamp) + 1).toISOString() : new Date(waitingClock).toISOString(),
  }] : visible;

  const send = async (submission: TaskSubmission) => {
      if (busy.current || (!submission.content.trim() && submission.files.length === 0)) return;
      busy.current = true;
      setSending(true);
      setFailedSend(submission);
      setSendError('');
      setScrollKey((k) => k + 1);
      try {
        let attachments:
          | { fileId: string; filename: string; contentType: string; url: string }[]
          | undefined;
        if (submission.files.length > 0) {
          for (const pending of submission.files) {
            if (submission.uploaded.has(pending.file)) continue;
            const uploaded = await workspaceApi.uploadFile(pending.file, sessionId);
            submission.uploaded.set(pending.file, {
              fileId: uploaded.id, filename: uploaded.filename, contentType: uploaded.contentType,
              url: workspaceApi.getFileUrl(uploaded.id),
            });
          }
          attachments = Array.from(submission.uploaded.values());
        }
        const event = await workspaceApi.sendMessage(
          sessionId,
          submission.content || (attachments ? attachments.map((a) => a.filename).join(', ') : ''),
          currentUser.name,
          submission.mentions.length > 0 ? submission.mentions : undefined,
          attachments,
          currentUser.id,
        );
        if (scope.current !== sessionId) return;
        setConfirmedMessages((previous) => mergeMessages(previous, [eventToMessage(event)]));
        setFailedSend(null);
        setDraft('');
        forceRefresh();
        if (projectContext) await refreshTaskState();
      } catch (failure: unknown) {
        if (scope.current !== sessionId) return;
        const errorText = failure instanceof Error ? failure.message : 'Unable to send message';
        setDraft(submission.content);
        setInputVersion((version) => version + 1);
        setSendError(errorText);
        toast.error(errorText);
      } finally {
        busy.current = false;
        if (scope.current === sessionId) setSending(false);
      }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 py-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            {assignee && <AgentAvatar name={assignee} size={20} />}
            <span className="truncate" title={taskTitle}>{taskTitle}</span>
          </DialogTitle>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
          )}
          {(description || acceptanceCriteria) && <details className="mt-2 max-h-[28vh] overflow-y-auto text-left text-xs font-normal text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">{locale === 'zh-CN' ? '任务要求' : 'Task requirements'}</summary>
            {description && <p className="mt-2 whitespace-pre-wrap break-words">{description}</p>}
            {acceptanceCriteria && <p className="mt-2 whitespace-pre-wrap break-words"><span className="font-medium text-foreground">{locale === 'zh-CN' ? '验收标准：' : 'Acceptance criteria: '}</span>{acceptanceCriteria}</p>}
          </details>}
          {submittedSummary && <p className="mt-2 rounded border border-border bg-muted/40 px-2 py-1.5 text-xs font-normal whitespace-pre-wrap">{submittedSummary}</p>}
          {submissionHistory && submissionHistory.length > 1 && <details className="mt-1 text-xs font-normal text-muted-foreground"><summary className="cursor-pointer">{locale === 'zh-CN' ? '提交历史' : 'Submission history'} ({submissionHistory.length})</summary><ol className="max-h-28 overflow-auto pt-1">{submissionHistory.map((entry, index) => <li key={index} className="border-t py-1 whitespace-pre-wrap">{entry.summary}</li>)}</ol></details>}
        </DialogHeader>

        {/* ChatMessages' root is `flex-1 min-h-0`, so it must be a DIRECT child
            of this flex column to get a bounded height and scroll — wrapping it
            in a plain div collapses that and the list overflows the dialog. */}
        <div className="flex flex-col h-[60vh] min-h-0">
          {pollingError && <p role="alert" className="px-4 py-2 text-xs text-destructive">{pollingError}</p>}
          {stateError && projectContext && <div role="alert" className="flex items-center gap-2 px-4 py-2 text-xs text-destructive">
            <span className="min-w-0 flex-1">{locale === 'zh-CN' ? '任务状态加载失败' : 'Could not load task status'}</span>
            <button type="button" onClick={() => void refreshTaskState()} title={locale === 'zh-CN' ? '重试' : 'Retry'} aria-label={locale === 'zh-CN' ? '重试' : 'Retry'} className="flex size-8 items-center justify-center rounded-md hover:bg-muted"><RotateCcw className="size-4" /></button>
          </div>}
          <ChatMessages
            messages={displayed}
            agents={agents}
            showAllSteps={false}
            preserveThinkingHistory={projectTask}
            scrollKey={scrollKey + generation}
            loadOlder={loadOlder}
            hasOlder={hasOlder}
            loadingOlder={loadingOlder}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
          />
          {failedSend && !sending && <div role="alert" className="mx-3 flex items-center gap-2 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <span className="min-w-0 flex-1 break-words">
              {locale === 'zh-CN' ? '发送失败' : 'Message not sent'}: {sendError}
              {failedSend.files.length > 0 && ` (${failedSend.files.map((item) => item.file.name).join(', ')})`}
            </span>
            <button type="button" onClick={() => void send(failedSend)} title={locale === 'zh-CN' ? '重试发送' : 'Retry sending'} aria-label={locale === 'zh-CN' ? '重试发送' : 'Retry sending'} className="flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-muted"><RotateCcw className="size-4" /></button>
            <button type="button" onClick={() => { setFailedSend(null); setSendError(''); }} title={locale === 'zh-CN' ? '取消重试' : 'Dismiss retry'} aria-label={locale === 'zh-CN' ? '取消重试' : 'Dismiss retry'} className="flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-muted"><X className="size-4" /></button>
          </div>}
          <div className="shrink-0 border-t border-border p-3">
            <ChatInput
              key={inputVersion}
              draft={draft}
              onDraftChange={(value) => { if (busy.current && value === '') return; setDraft(value); }}
              onSend={(content, mentions, files) => {
                setDraft(content);
                void send({ content, mentions, files, uploaded: new Map() });
              }}
              agents={projectContext && (!task || projectTask) ? taskAgents : agents}
              projectMentions={projectContext && (!task || projectTask) ? {
                agents: taskAgents, participantNames: channel?.participants ?? [], members: [],
                membersError: false, onRetryMembers: () => {},
                workflowRunning: Boolean(task?.workflowId), activeWorkflowStepAgent: targetName,
              } : undefined}
              disabled={!canWrite || sending || Boolean(failedSend)}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
