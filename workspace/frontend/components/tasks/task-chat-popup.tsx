'use client';

import { useCallback, useState } from 'react';
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

interface TaskChatPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The task's hidden working thread (channel name). */
  sessionId: string;
  taskTitle: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  assignee: string | null;
  /** Optional status line under the title, e.g. workflow step progress. */
  subtitle?: string;
  submittedSummary?: string | null;
  submissionHistory?: Array<{ summary: string; submittedAt?: string; submittedBy?: string }>;
}

/**
 * A lightweight, self-contained chat window over a single task thread.
 *
 * The task thread is hidden from the main thread list, so this popup is the
 * only place a human drops into it. Rather than reuse the full `ChatView`
 * (hard-coupled to the global `currentSessionId`), we compose the same two
 * children it uses — `ChatMessages` + `ChatInput` — against a `sessionId` prop.
 */
export function TaskChatPopup({ open, onOpenChange, sessionId, taskTitle, description, acceptanceCriteria, assignee, subtitle, submittedSummary, submissionHistory }: TaskChatPopupProps) {
  const { locale } = useI18n();
  const workspaceApi = useWorkspaceApi();
  const { agents, currentUser, canWrite = true } = useWorkspace();
  const { messages, forceRefresh, generation, loadOlder, hasOlder, loadingOlder, error: pollingError } = useMessagePolling({
    sessionId,
    enabled: open,
  });
  const [scrollKey, setScrollKey] = useState(0);

  const handleSend = useCallback(
    async (content: string, mentions: string[] = [], files: PendingFile[] = []) => {
      if (!content.trim() && files.length === 0) return;
      setScrollKey((k) => k + 1);
      try {
        let attachments:
          | { fileId: string; filename: string; contentType: string; url: string }[]
          | undefined;
        if (files.length > 0) {
          const uploaded = await Promise.all(files.map((pf) => workspaceApi.uploadFile(pf.file, sessionId)));
          attachments = uploaded.map((f) => ({
            fileId: f.id,
            filename: f.filename,
            contentType: f.contentType,
            url: workspaceApi.getFileUrl(f.id),
          }));
        }
        await workspaceApi.sendMessage(
          sessionId,
          content || (attachments ? attachments.map((a) => a.filename).join(', ') : ''),
          currentUser.name,
          mentions.length > 0 ? mentions : undefined,
          attachments,
          currentUser.id,
        );
        forceRefresh();
      } catch (failure: unknown) {
        toast.error(failure instanceof Error ? failure.message : 'Unable to send message');
      }
    },
    [sessionId, currentUser.name, currentUser.id, forceRefresh],
  );

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
          <ChatMessages
            messages={messages}
            agents={agents}
            showAllSteps={false}
            scrollKey={scrollKey + generation}
            loadOlder={loadOlder}
            hasOlder={hasOlder}
            loadingOlder={loadingOlder}
            className="h-full overflow-y-auto px-4 py-3"
          />
          <div className="border-t border-border p-3">
            <ChatInput onSend={handleSend} agents={agents} disabled={!canWrite} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
