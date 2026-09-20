'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  KanbanSquare,
  Plus,
  RefreshCw,
  Trash2,
  Pencil,
  UserPlus,
  ChevronDown,
  Play,
  Square,
  RotateCcw,
  Waypoints,
  BookOpen,
  Paperclip,
  Check,
  Send,
  Settings2,
  X,
} from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useWorkspaceApi } from '@/lib/workspace-api-context';
import { useLayout } from '@/components/layout/layout-context';
import { DetailHeader } from '@/components/layout/app-header';
import { FeatureTourBanner } from '@/components/tours/feature-tours';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { agentLabel } from '@/lib/helpers';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { KanbanTask } from '@/lib/types';
import { useFormatters, useI18n, useT } from '@/lib/i18n';
import { AttachmentPicker, NewTaskDialog } from './new-task-dialog';
import { TaskChatPopup } from './task-chat-popup';
import { TaskExecutionDialog, type TaskExecutionConfig } from './task-execution-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/responsive-dialog';

// ── Card ──────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onSetAssignee,
  onRun,
  onStop,
  onOpenChat,
  onEdit,
  onDelete,
  onConfigure,
  onAccept,
  onDecline,
  onSubmit,
  onAcceptTransfer,
  onCompleteStep,
  busy,
}: {
  task: KanbanTask;
  onSetAssignee: (agent: string) => void;
  onRun: () => void;
  onStop: () => void;
  onOpenChat: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onConfigure: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onSubmit: () => void;
  onAcceptTransfer: () => void;
  onCompleteStep: () => void;
  busy: boolean;
}) {
  const t = useT();
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const { timeAgo } = useFormatters();
  const { agents, workflows, canWrite = true, me } = useWorkspace();
  const dispatched = Boolean(task.responsibleUserId);
  const ownTask = !dispatched || task.responsibleUserId === me?.userId;
  const canManage = canWrite && ownTask;
  const pendingTransfer = dispatched && task.transferUserId === me?.userId && task.responsibleUserId !== me?.userId;
  const onlineAgents = agents.filter((a) => a.status === 'online');

  const isBacklog = task.status === 'backlog' || task.status === 'todo';
  const isRunning = task.status === 'in_progress';
  const needsInput = task.status === 'need_input';
  const aiNeedsInput = dispatched && task.executionStatus === 'need_input';
  const executionRunning = dispatched && (task.executionStatus === 'running' || aiNeedsInput);
  const openable = !!task.channelName;
  const runnable = !!task.assignee || !!task.workflowId;
  const workflowName = task.workflowId
    ? (workflows.find((w) => w.id === task.workflowId)?.name || t('views.workflows'))
    : '';

  return (
    <div
      onClick={openable ? onOpenChat : isBacklog && canWrite && !dispatched ? onEdit : undefined}
      title={openable ? t('tasks.openChat') : isBacklog ? t('tasks.editTaskTitle') : undefined}
      className={cn(
        'group relative rounded-lg border bg-card p-3 shadow-sm transition-colors',
        openable || isBacklog ? 'cursor-pointer hover:border-foreground/30' : 'hover:border-foreground/20',
        needsInput ? 'border-rose-400/70' : isRunning ? 'border-amber-400/70' : 'border-border',
      )}
    >
      {/* Submission needs attention; on human tasks running is an ownership state, not an AI run. */}
      {(needsInput || (isRunning && !dispatched)) && (
        <span
          className={cn(
            'pointer-events-none absolute inset-0 rounded-lg ring-2 animate-pulse',
            needsInput ? 'ring-rose-400/70' : 'ring-amber-400/70',
          )}
        />
      )}

      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug break-words min-w-0">{task.title}</p>
        {canWrite && !dispatched && <div className="flex items-center gap-1.5 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          {isBacklog && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="-m-1 p-1 text-muted-foreground hover:text-foreground"
              title={t('tasks.editTaskTitle')}
            >
              <Pencil className="size-3.5" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="-m-1 p-1 text-muted-foreground hover:text-rose-500"
            title={t('tasks.deleteTask')}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>}
      </div>

      {needsInput && (
        <span className="mt-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400 bg-rose-500/10">
          {dispatched ? (zh ? '待管理员审核' : 'Awaiting review') : t('tasks.needsInput')}
        </span>
      )}
      {aiNeedsInput && <span className="mt-1.5 ml-1 inline-flex rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{zh ? '智能体等待输入' : 'AI needs input'}</span>}
      {pendingTransfer && <span className="mt-1.5 inline-flex rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{zh ? '待接收交接' : 'Transfer pending'}</span>}
      {task.declineReason && <p className="mt-1.5 text-xs text-muted-foreground">{zh ? '拒绝原因：' : 'Declined: '}{task.declineReason}</p>}

      {/* Need-input question: surface the thread's last message so the human
          can often see what's being asked without opening the popup. */}
      {needsInput && !dispatched && task.lastMessage && (
        <p className="mt-1.5 rounded-md bg-rose-500/5 border border-rose-400/20 px-2 py-1.5 text-[11px] text-muted-foreground leading-snug line-clamp-3 whitespace-pre-wrap">
          {task.lastMessage}
        </p>
      )}

      {task.description && (
        <p className="mt-1 text-xs text-muted-foreground leading-snug line-clamp-3 whitespace-pre-wrap">
          {task.description}
        </p>
      )}
      {dispatched && task.acceptanceCriteria && <p className="mt-1 text-xs text-muted-foreground">{zh ? '验收标准：' : 'Acceptance: '}{task.acceptanceCriteria}</p>}
      {dispatched && task.submittedSummary && <p className="mt-2 rounded border border-border bg-muted/40 px-2 py-1.5 text-xs whitespace-pre-wrap">{zh ? '提交结果：' : 'Submission: '}{task.submittedSummary}</p>}

      {/* Workflow progress: “Step 2/3 · Review” + step dots. */}
      {task.workflowId && task.run && task.run.stepCount > 0 && (isRunning || needsInput || task.run.status === 'paused') && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="flex items-center gap-0.5">
            {Array.from({ length: task.run.stepCount }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'size-1.5 rounded-full',
                  i < task.run!.stepIndex ? 'bg-emerald-500'
                    : i === task.run!.stepIndex ? (needsInput ? 'bg-rose-500' : 'bg-amber-500 animate-pulse')
                    : 'bg-muted-foreground/25',
                )}
              />
            ))}
          </span>
          <span className="text-[10px] text-muted-foreground truncate">
            {t('tasks.stepProgress', { current: task.run.stepIndex + 1, total: task.run.stepCount })}
            {task.run.stepName ? ` · ${task.run.stepName}` : ''}
            {task.run.stepAssignee ? ` · @${task.run.stepAssignee}` : ''}
          </span>
          {/* Loop counter — visible churn for draft/review-style cycles. */}
          {task.run.iterations > 0 && (
            <span
              className="shrink-0 text-[10px] font-medium text-amber-600 dark:text-amber-400"
              title={t('workflows.maxIterations')}
            >
              ↺ {task.run.iterations}/{task.run.maxIterations}
            </span>
          )}
        </div>
      )}

      {/* Live activity: what the agent is doing right now (thread-list style). */}
      {isRunning && !dispatched && task.lastMessage && (
        <p className="mt-1.5 text-[11px] italic text-muted-foreground/70 leading-snug line-clamp-2 whitespace-pre-wrap">
          {task.lastMessage}
        </p>
      )}

      {/* Relative timestamp — added / updated / done — plus attached context. */}
      <p className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
        <span>
          {task.status === 'done'
            ? t('tasks.metaDone', { time: timeAgo(task.updatedAt || task.createdAt) })
            : isBacklog
              ? t('tasks.metaAdded', { time: timeAgo(task.createdAt) })
              : t('tasks.metaUpdated', { time: timeAgo(task.updatedAt || task.createdAt) })}
        </span>
        {task.knowledgeIds.length > 0 && (
          <span className="inline-flex items-center gap-0.5" title={t('tasks.contextCount', { count: task.knowledgeIds.length })}>
            · <BookOpen className="size-3" /> {task.knowledgeIds.length}
          </span>
        )}
        {task.fileIds.length > 0 && (
          <span className="inline-flex items-center gap-0.5" title={t('tasks.attachedCount', { count: task.fileIds.length })}>
            · <Paperclip className="size-3" /> {task.fileIds.length}
          </span>
        )}
      </p>

      <div className="mt-1.5 flex items-center gap-2">
        {dispatched && pendingTransfer && <button disabled={busy} type="button" onClick={(event) => { event.stopPropagation(); onAcceptTransfer(); }} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-500/10"><Check className="size-3.5" />{zh ? '接收交接' : 'Accept transfer'}</button>}
        {dispatched && isBacklog && canManage && !task.transferUserId && !task.declineReason && <>
          <button disabled={busy} type="button" onClick={(event) => { event.stopPropagation(); onConfigure(); }} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted"><Settings2 className="size-3.5" />{zh ? '配置' : 'Configure'}</button>
          <button disabled={busy} type="button" onClick={(event) => { event.stopPropagation(); onAccept(); }} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-500/10"><Check className="size-3.5" />{zh ? '接收任务' : 'Accept'}</button>
          <button disabled={busy} type="button" onClick={(event) => { event.stopPropagation(); onDecline(); }} title={zh ? '拒绝任务' : 'Decline task'} aria-label={zh ? '拒绝任务' : 'Decline task'} className="rounded p-1 text-muted-foreground hover:text-destructive"><X className="size-3.5" /></button>
        </>}
        {dispatched && isRunning && canManage && !task.transferUserId && <>
          {!executionRunning && <button disabled={busy} type="button" onClick={(event) => { event.stopPropagation(); onConfigure(); }} title={zh ? '调整执行配置' : 'Configure execution'} aria-label={zh ? '调整执行配置' : 'Configure execution'} className="rounded p-1 text-muted-foreground hover:text-foreground"><Settings2 className="size-3.5" /></button>}
          {runnable && !executionRunning && <button disabled={busy} type="button" onClick={(event) => { event.stopPropagation(); onRun(); }} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-500/10"><Play className="size-3.5" />{t('tasks.run')}</button>}
          {executionRunning && <button disabled={busy} type="button" onClick={(event) => { event.stopPropagation(); onStop(); }} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-rose-600 hover:bg-rose-500/10"><Square className="size-3" />{t('tasks.stop')}</button>}
          {task.run?.stepAssigneeKind === 'human' && task.executionStatus === 'need_input' && <button disabled={busy} type="button" onClick={(event) => { event.stopPropagation(); onCompleteStep(); }} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-amber-700 hover:bg-amber-500/10"><Check className="size-3.5" />{zh ? '完成当前步骤' : 'Complete step'}</button>}
          <button disabled={busy} type="button" onClick={(event) => { event.stopPropagation(); onSubmit(); }} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-foreground hover:bg-muted"><Send className="size-3.5" />{zh ? '提交审核' : 'Submit for review'}</button>
        </>}
        {/* Run — backlog only. Needs an agent or a workflow first. */}
        {!dispatched && isBacklog && canWrite && (
          <button
            onClick={(e) => { e.stopPropagation(); if (runnable) onRun(); }}
            disabled={!runnable}
            className={cn(
              'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors',
              runnable
                ? 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
                : 'text-muted-foreground/40 cursor-not-allowed',
            )}
            title={runnable ? t('tasks.run') : t('tasks.assignFirst')}
          >
            <Play className="size-3.5" />
            {t('tasks.run')}
          </button>
        )}

        {/* Stop — while running or awaiting input. */}
        {!dispatched && (isRunning || needsInput) && canWrite && (
          <button
            onClick={(e) => { e.stopPropagation(); onStop(); }}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors"
            title={t('tasks.stop')}
          >
            <Square className="size-3 fill-current" />
            {t('tasks.stop')}
          </button>
        )}

        {/* Re-run — a done task can be run again (workflow restarts at step 1). */}
        {!dispatched && task.status === 'done' && runnable && canWrite && (
          <button
            onClick={(e) => { e.stopPropagation(); onRun(); }}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
            title={t('tasks.rerun')}
          >
            <RotateCcw className="size-3.5" />
            {t('tasks.rerun')}
          </button>
        )}

        <div className="flex-1" />

        {/* Workflow task: show a workflow badge instead of the agent picker. */}
        {task.workflowId ? (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground max-w-32 truncate" title={workflowName}>
            <Waypoints className="size-3.5 shrink-0" />
            <span className="truncate">{workflowName}</span>
          </span>
        ) : !dispatched && isBacklog && canWrite ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title={task.assignee ? t('tasks.reassign') : t('tasks.assign')}
              >
                {task.assignee ? (
                  <>
                    <AgentAvatar name={task.assignee} size={18} />
                    <ChevronDown className="size-3" />
                  </>
                ) : (
                  <>
                    <UserPlus className="size-3.5" />
                    <span>{t('tasks.assign')}</span>
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>{t('tasks.assignTo')}</DropdownMenuLabel>
              {onlineAgents.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('tasks.noAgentsOnline')}</div>
              ) : (
                onlineAgents.map((a) => (
                  <DropdownMenuItem
                    key={a.agentName}
                    onClick={(e) => { e.stopPropagation(); onSetAssignee(a.agentName); }}
                    className="gap-2"
                  >
                    <AgentAvatar name={a.agentName} size={18} />
                    <span className="truncate">{agentLabel(a)}</span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          task.assignee && <AgentAvatar name={task.assignee} size={18} />
        )}
      </div>
    </div>
  );
}

// ── Column ────────────────────────────────────────────────────────────────

function BoardColumn({
  dotClass,
  title,
  count,
  canAdd,
  onAdd,
  className,
  children,
}: {
  dotClass: string;
  title: string;
  count: number;
  canAdd?: boolean;
  onAdd?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col rounded-xl border border-border/60 bg-muted/30 min-h-0', className)}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className={cn('size-2 rounded-full', dotClass)} />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground/60">{count}</span>
        <div className="flex-1" />
        {canAdd && onAdd && (
          <button onClick={onAdd} className="text-muted-foreground hover:text-foreground transition-colors" title={title}>
            <Plus className="size-3.5" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">{children}</div>
    </div>
  );
}

// ── Board ─────────────────────────────────────────────────────────────────

export function TasksView() {
  const { tasks, refreshTasks, createTask, updateTask, runTask, stopTask, deleteTask, canWrite = true, workspace } = useWorkspace();
  const api = useWorkspaceApi();
  const t = useT();
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const projectTaskPool = workspace?.kind === 'project';

  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [editTask, setEditTask] = useState<KanbanTask | null>(null);
  const [chatTask, setChatTask] = useState<KanbanTask | null>(null);
  const [configuredTask, setConfiguredTask] = useState<KanbanTask | null>(null);
  const [dialogAction, setDialogAction] = useState<{ task: KanbanTask; kind: 'submit' | 'decline' | 'step' } | null>(null);
  const [actionText, setActionText] = useState('');
  const [submittedFiles, setSubmittedFiles] = useState<string[]>([]);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  // The popup should reflect live poll updates (step progress, status), not
  // the snapshot captured when it was opened.
  const liveChatTask = chatTask ? tasks.find((x) => x.id === chatTask.id) ?? chatTask : null;

  useEffect(() => {
    refreshTasks();
  }, [refreshTasks]);

  // Deep-link from the Inbox: open the chat popup for the requested task
  // thread once the board has it.
  const { pendingTaskChannel, setPendingTaskChannel } = useLayout();
  useEffect(() => {
    if (!pendingTaskChannel) return;
    const target = tasks.find((x) => x.channelName === pendingTaskChannel);
    if (target) {
      setChatTask(target);
      setPendingTaskChannel(null);
      return;
    }
    if (!pendingTaskChannel.startsWith('task:')) return;
    let cancelled = false;
    void api.getTask(pendingTaskChannel.slice(5)).then((task) => {
      if (!cancelled) { setChatTask(task); setPendingTaskChannel(null); }
    }).catch(() => { if (!cancelled) { setActionError(zh ? '无法打开该任务' : 'Could not open this task'); setPendingTaskChannel(null); } });
    return () => { cancelled = true; };
  }, [pendingTaskChannel, tasks, setPendingTaskChannel, api, zh]);

  const actOnTask = async (task: KanbanTask, action: () => Promise<unknown>) => {
    setBusyTaskId(task.id);
    setActionError('');
    try {
      await action();
      await refreshTasks();
      if (chatTask?.id === task.id) setChatTask(await api.getTask(task.id));
      return true;
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : zh ? '操作失败' : 'Action failed');
      return false;
    } finally { setBusyTaskId(null); }
  };

  const configure = async (task: KanbanTask, config: TaskExecutionConfig) => {
    if (await actOnTask(task, () => api.configureTask(task.id, config))) setConfiguredTask(null);
  };

  const submitAction = async () => {
    if (!dialogAction || !actionText.trim()) return;
    const { task, kind } = dialogAction;
    const success = await actOnTask(task, () => kind === 'submit'
      ? api.submitTask(task.id, actionText.trim(), submittedFiles)
      : kind === 'decline' ? api.declineTask(task.id, actionText.trim())
        : api.completeTaskStep(task.id, actionText.trim()));
    if (success) { setDialogAction(null); setActionText(''); setSubmittedFiles([]); }
  };

  const openAction = (task: KanbanTask, kind: 'submit' | 'decline' | 'step') => {
    setActionText(''); setSubmittedFiles([]); setDialogAction({ task, kind });
  };

  const { backlog, inProgress, needsAttention, done } = useMemo(() => {
    const b: KanbanTask[] = [], p: KanbanTask[] = [], n: KanbanTask[] = [], d: KanbanTask[] = [];
    for (const task of tasks) {
      if (task.status === 'done') d.push(task);
      else if (task.status === 'need_input') n.push(task);
      else if (task.status === 'in_progress') p.push(task);
      else b.push(task); // backlog (+ any legacy 'todo')
    }
    const sort = (arr: KanbanTask[]) =>
      arr.sort((a, c) => a.position - c.position || (a.createdAt || '').localeCompare(c.createdAt || ''));
    return { backlog: sort(b), inProgress: sort(p), needsAttention: sort(n), done: sort(d) };
  }, [tasks]);

  const renderCards = (items: KanbanTask[]) =>
    items.map((task) => (
      <TaskCard
        key={task.id}
        task={task}
        onSetAssignee={(agent) => updateTask(task.id, { assignee: agent })}
        onRun={() => { if (task.responsibleUserId) void actOnTask(task, () => runTask(task.id)); else void runTask(task.id); }}
        onStop={() => { if (task.responsibleUserId) void actOnTask(task, () => stopTask(task.id)); else void stopTask(task.id); }}
        onOpenChat={() => setChatTask(task)}
        onEdit={() => setEditTask(task)}
        onDelete={() => deleteTask(task.id)}
        onConfigure={() => setConfiguredTask(task)}
        onAccept={() => void actOnTask(task, () => api.acceptTask(task.id))}
        onDecline={() => openAction(task, 'decline')}
        onSubmit={() => openAction(task, 'submit')}
        onAcceptTransfer={() => void actOnTask(task, () => api.acceptTaskTransfer(task.id))}
        onCompleteStep={() => openAction(task, 'step')}
        busy={busyTaskId === task.id}
      />
    ));

  return (
    <div className="h-full flex flex-col">
      <DetailHeader
        title={<>
          <KanbanSquare className="size-4 text-foreground" />
          <h2 className="text-sm font-semibold">{t('views.tasks')}</h2>
        </>}
      >
        {!projectTaskPool && <Button size="sm" disabled={!canWrite} onClick={() => setNewTaskOpen(true)} className="gap-1.5">
          <Plus className="size-3.5" />
          {t('tasks.newTask')}
        </Button>}
        <button
          onClick={refreshTasks}
          className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </DetailHeader>

      <FeatureTourBanner feature="tasks" />
      {actionError && <p role="alert" className="mx-4 mt-2 rounded border border-destructive/30 px-3 py-2 text-xs text-destructive">{actionError}</p>}

      {/* Board — four equal columns in lifecycle order (Backlog → In Progress →
          Needs attention → Done). Stacks vertically on mobile with whole-board
          scroll; on ≥sm each column scrolls within a fixed height. */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:overflow-hidden sm:p-4">
        <div className="flex flex-col gap-3 sm:h-full sm:min-h-0 sm:flex-row">
          <BoardColumn
            dotClass="bg-zinc-400"
            title={t('tasks.col.backlog')}
            count={backlog.length}
            canAdd={canWrite && !projectTaskPool}
            onAdd={() => setNewTaskOpen(true)}
            className="sm:flex-1 sm:min-w-0"
          >
            {/* The primary add affordance: a big, unmissable button that opens
                the full create dialog (title/description/context/run-with). */}
            {!projectTaskPool && <Button
              size="lg"
              disabled={!canWrite}
              onClick={() => setNewTaskOpen(true)}
              className="w-full gap-1.5 shrink-0"
            >
              <Plus className="size-4" />
              {t('tasks.newTask')}
            </Button>}
            {backlog.length === 0 && projectTaskPool && <p className="px-1 py-6 text-center text-xs text-muted-foreground">{zh ? '暂无待接收任务' : 'No tasks to accept'}</p>}
            {renderCards(backlog)}
          </BoardColumn>

          <BoardColumn
            dotClass="bg-amber-500"
            title={t('tasks.col.in_progress')}
            count={inProgress.length}
            className="sm:flex-1 sm:min-w-0"
          >
            {inProgress.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-muted-foreground/50">{t('tasks.emptyInProgress')}</p>
            ) : renderCards(inProgress)}
          </BoardColumn>

          <BoardColumn
            dotClass="bg-rose-500"
            title={projectTaskPool ? (zh ? '需要关注 · 待审核' : 'Attention · awaiting review') : t('tasks.col.need_input')}
            count={needsAttention.length}
            className="sm:flex-1 sm:min-w-0"
          >
            {needsAttention.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-muted-foreground/50">{t('tasks.emptyNeedsAttention')}</p>
            ) : renderCards(needsAttention)}
          </BoardColumn>

          <BoardColumn
            dotClass="bg-emerald-500"
            title={t('tasks.col.done')}
            count={done.length}
            className="sm:flex-1 sm:min-w-0"
          >
            {done.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-muted-foreground/50">{t('tasks.emptyDone')}</p>
            ) : renderCards(done)}
          </BoardColumn>
        </div>
      </div>

      <NewTaskDialog
        open={canWrite && (newTaskOpen || !!editTask)}
        onOpenChange={(o) => {
          if (!o) { setNewTaskOpen(false); setEditTask(null); }
        }}
        task={editTask}
        onSubmit={({ title, description, assignee, workflowId, knowledgeIds, fileIds }) => {
          if (editTask) {
            updateTask(editTask.id, { title, description, assignee, workflowId, knowledgeIds, fileIds });
          } else {
            createTask({ title, description, assignee, workflowId, knowledgeIds, fileIds, status: 'backlog' });
          }
        }}
      />

      {configuredTask && <TaskExecutionDialog key={configuredTask.id} task={tasks.find((task) => task.id === configuredTask.id) ?? configuredTask} busy={busyTaskId === configuredTask.id} onClose={() => setConfiguredTask(null)} onSave={(config) => configure(configuredTask, config)} />}

      <Dialog open={Boolean(dialogAction)} onOpenChange={(open) => { if (!open && !busyTaskId) setDialogAction(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogAction?.kind === 'submit' ? (zh ? '提交管理员审核' : 'Submit for review') : dialogAction?.kind === 'decline' ? (zh ? '拒绝任务' : 'Decline task') : (zh ? '完成工作流步骤' : 'Complete workflow step')}</DialogTitle>
            <DialogDescription>{dialogAction?.task.title}</DialogDescription>
          </DialogHeader>
          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
            <span>{dialogAction?.kind === 'submit' ? (zh ? '结果摘要' : 'Result summary') : dialogAction?.kind === 'decline' ? (zh ? '拒绝原因' : 'Reason') : (zh ? '步骤结果' : 'Step result')}</span>
            <textarea aria-label={dialogAction?.kind === 'submit' ? (zh ? '结果摘要' : 'Result summary') : (zh ? '说明' : 'Details')} rows={4} value={actionText} onChange={(event) => setActionText(event.target.value)} className="block w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring" />
          </label>
          {dialogAction?.kind === 'submit' && <AttachmentPicker value={submittedFiles} onChange={setSubmittedFiles} />}
          <DialogFooter>
            <Button variant="outline" disabled={Boolean(busyTaskId)} onClick={() => setDialogAction(null)}>{zh ? '取消' : 'Cancel'}</Button>
            <Button disabled={Boolean(busyTaskId) || !actionText.trim()} onClick={() => void submitAction()}>{zh ? '确认' : 'Confirm'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {liveChatTask?.channelName && (
        <TaskChatPopup
          open={!!liveChatTask}
          onOpenChange={(o) => !o && setChatTask(null)}
          sessionId={liveChatTask.channelName}
          taskTitle={liveChatTask.title}
          submissionHistory={liveChatTask.submissionHistory}
          submittedSummary={liveChatTask.submittedSummary}
          assignee={liveChatTask.assignee}
          subtitle={
            liveChatTask.run && liveChatTask.run.stepCount > 0 && liveChatTask.run.stepIndex >= 0
              ? `${t('tasks.stepProgress', { current: liveChatTask.run.stepIndex + 1, total: liveChatTask.run.stepCount })}${liveChatTask.run.stepName ? ` · ${liveChatTask.run.stepName}` : ''}`
              : undefined
          }
        />
      )}
    </div>
  );
}
