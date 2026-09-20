'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  Clock3,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
  User,
  X,
} from 'lucide-react';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { AuthenticatedFileImage } from '@/components/files/authenticated-file-image';
import { Button } from '@/components/ui/button';
import { MarkdownToolbar } from '@/components/ui/markdown-toolbar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/responsive-dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WorkspaceApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type {
  KanbanTask,
  ProjectPlanItem,
  TaskAttachment,
  TaskReview,
  TaskTimelineActorType,
  TaskTimelineItem,
  TaskTimelineView,
  TeamMember,
  WorkspaceFile,
} from '@/lib/types';
import { useWorkspaceApi } from '@/lib/workspace-api-context';
import { cn } from '@/lib/utils';

export type { TaskTimelineView } from '@/lib/types';

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const COMMENT_ACCEPT = 'image/*,.pdf,.txt,.md,.json,.csv,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.hpp,.sh,.yaml,.yml,.toml,.zip';
const TIMELINE_VIEWS: TaskTimelineView[] = ['all', 'activity', 'comments', 'transition', 'history'];

type UploadState = 'uploading' | 'uploaded' | 'error';
interface CommentUpload {
  key: string;
  file: File;
  state: UploadState;
  progress: number;
  uploaded?: WorkspaceFile;
  error?: string;
  preview?: string;
  controller?: AbortController;
}

interface TaskDetailSheetProps {
  taskId: string | null;
  planItem: ProjectPlanItem | null;
  open: boolean;
  canManage: boolean;
  initialView?: TaskTimelineView;
  onViewChange?: (view: TaskTimelineView) => void;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void | Promise<void>;
}

function memberId(member: TeamMember) {
  return member.userId ?? member.id ?? '';
}

function isTimelineView(value: string | undefined): value is TaskTimelineView {
  return Boolean(value && TIMELINE_VIEWS.includes(value as TaskTimelineView));
}

function mergeTimeline(current: TaskTimelineItem[], incoming: TaskTimelineItem[], sort: 'asc' | 'desc') {
  const records = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => records.set(item.id, item));
  return Array.from(records.values()).sort((left, right) => {
    const order = Date.parse(left.createdAt || '1970-01-01') - Date.parse(right.createdAt || '1970-01-01');
    if (order !== 0) return sort === 'asc' ? order : -order;
    return sort === 'asc' ? left.id.localeCompare(right.id) : right.id.localeCompare(left.id);
  });
}

function humanValue(value: unknown, zh: boolean, members: TeamMember[] = []): string {
  if (value === null || value === undefined || value === '') return zh ? '未设置' : 'Not set';
  if (typeof value === 'boolean') return value ? (zh ? '是' : 'Yes') : (zh ? '否' : 'No');
  if (Array.isArray(value)) return value.map((entry) => humanValue(entry, zh, members)).join(', ');
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  if (typeof value === 'string') {
    const member = members.find((entry) => memberId(entry) === value);
    if (member) return member.displayName || member.username || member.email;
    const labels: Record<string, [string, string]> = {
      backlog: ['待接收', 'To accept'], todo: ['待处理', 'To do'], in_progress: ['进行中', 'In progress'],
      need_input: ['待审核', 'Awaiting review'], done: ['已完成', 'Done'], idle: ['空闲', 'Idle'],
      running: ['运行中', 'Running'], paused: ['已暂停', 'Paused'], manual: ['人工执行', 'Manual'],
      agent: ['Agent 执行', 'Agent'], workflow: ['工作流', 'Workflow'],
      urgent: ['紧急', 'Urgent'], high: ['高', 'High'], medium: ['中', 'Medium'], normal: ['普通', 'Normal'], low: ['低', 'Low'],
    };
    if (labels[value]) return labels[value][zh ? 0 : 1];
  }
  return String(value);
}

function timelineFieldLabel(field: string, zh: boolean) {
  const labels: Record<string, [string, string]> = {
    title: ['标题', 'Title'], description: ['描述', 'Description'], priority: ['优先级', 'Priority'],
    tags: ['标签', 'Tags'], startDate: ['开始日期', 'Start date'], dueDate: ['截止日期', 'Due date'],
    acceptanceCriteria: ['验收标准', 'Acceptance criteria'], fileIds: ['附件', 'Attachments'],
    sourceVersion: ['计划版本', 'Plan version'], responsibleUserId: ['负责人', 'Owner'],
    mode: ['执行方式', 'Execution mode'], agent: ['执行 Agent', 'Execution agent'],
    workflowId: ['工作流', 'Workflow'], knowledgeIds: ['知识上下文', 'Knowledge context'],
  };
  return labels[field]?.[zh ? 0 : 1] ?? field;
}

function formatDate(value: string | null | undefined, locale: string, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, withTime
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(status: KanbanTask['status'], zh: boolean) {
  const labels = zh
    ? { backlog: '待接收', todo: '待处理', in_progress: '进行中', need_input: '待审核', done: '已完成' }
    : { backlog: 'To accept', todo: 'To do', in_progress: 'In progress', need_input: 'Awaiting review', done: 'Done' };
  return labels[status];
}

function timelineKindLabel(kind: string, zh: boolean) {
  const normalized = kind.replace(/^workspace\.task\./, '');
  const labels: Record<string, [string, string]> = {
    activity: ['活动', 'Activity'],
    comment: ['评论', 'Comment'],
    message: ['执行消息', 'Execution message'],
    agent_chat: ['Agent 回复', 'Agent response'],
    agent_thinking: ['Agent 思考', 'Agent thinking'],
    agent_status: ['Agent 状态', 'Agent status'],
    configured: ['执行配置已更新', 'Execution configured'],
    requirements_published: ['计划变更已发布', 'Plan changes published'],
    dispatched: ['任务已派发', 'Task dispatched'],
    accepted: ['任务已接收', 'Task accepted'],
    declined: ['任务已拒绝', 'Task declined'],
    submitted: ['任务已提交', 'Task submitted'],
    execution_started: ['执行已开始', 'Execution started'],
    execution_stopped: ['执行已停止', 'Execution stopped'],
    execution_status_changed: ['执行状态已变更', 'Execution status changed'],
    transfer_requested: ['已发起交接', 'Transfer requested'],
    transfer_forced: ['已强制交接', 'Transfer forced'],
    transfer_accepted: ['已接收交接', 'Transfer accepted'],
    review_approved: ['审核已通过', 'Review approved'],
    review_returned: ['审核已退回', 'Review returned'],
    transition: ['状态流转', 'Transition'],
    history: ['字段已更新', 'Field updated'],
  };
  const known = labels[normalized];
  if (known) return known[zh ? 0 : 1];
  const readable = normalized.replace(/[._-]+/g, ' ').trim();
  return zh ? readable : readable.replace(/^\w/, (letter) => letter.toUpperCase());
}

function priorityLabel(priority: KanbanTask['priority'], zh: boolean) {
  if (!priority) return zh ? '未设置' : 'Not set';
  const labels = zh
    ? { urgent: '紧急', high: '高', medium: '中', normal: '普通', low: '低' }
    : { urgent: 'Urgent', high: 'High', medium: 'Medium', normal: 'Normal', low: 'Low' };
  return labels[priority];
}

function taskError(reason: unknown, zh: boolean) {
  if (reason instanceof WorkspaceApiError) {
    if (reason.status === 403) return zh ? '你没有查看该任务的权限' : 'You do not have access to this task';
    if (reason.status === 404) return zh ? '任务已不存在' : 'This task no longer exists';
  }
  return reason instanceof Error ? reason.message : zh ? '任务详情加载失败' : 'Could not load task details';
}

function AttachmentList({ files, onError }: { files: TaskAttachment[]; onError: (message: string) => void }) {
  const api = useWorkspaceApi();
  const images = files.filter((file) => file.contentType.startsWith('image/'));
  const others = files.filter((file) => !file.contentType.startsWith('image/'));
  if (!files.length) return null;
  return <div className="space-y-3">
    {images.length > 0 && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
      {images.map((file) => <button key={file.id} type="button" onClick={() => void api.downloadFile(file.id, file.filename).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : 'Download failed'))} className="group relative aspect-[4/3] overflow-hidden rounded-md border border-border bg-muted text-left focus-visible:outline-2 focus-visible:outline-ring" title={file.filename}>
        <AuthenticatedFileImage fileId={file.id} contentType={file.contentType} alt={file.filename} className="size-full object-cover transition-transform group-hover:scale-[1.02]" loading="lazy" />
        <span className="absolute inset-x-0 bottom-0 truncate bg-background/90 px-2 py-1 text-[11px] backdrop-blur-sm">{file.filename}</span>
      </button>)}
    </div>}
    {others.length > 0 && <ul className="divide-y divide-border rounded-md border border-border">
      {others.map((file) => <li key={file.id}><button type="button" onClick={() => void api.downloadFile(file.id, file.filename).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : 'Download failed'))} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-xs hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"><FileText className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{file.filename}</span><span className="shrink-0 text-muted-foreground">{formatSize(file.size)}</span></button></li>)}
    </ul>}
  </div>;
}

function MetadataCell({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0 border-b border-border px-4 py-3 sm:border-b-0 sm:border-r sm:last:border-r-0">
    <p className="text-[11px] text-muted-foreground">{label}</p>
    <div className="mt-1 truncate text-sm font-medium">{children}</div>
  </div>;
}

function EventActorIcon({ type }: { type: TaskTimelineActorType }) {
  if (type === 'human') return <User className="size-3.5" />;
  if (type === 'agent') return <Bot className="size-3.5" />;
  return <Settings2 className="size-3.5" />;
}

function EventBody({ item, zh, members, onDownloadError }: { item: TaskTimelineItem; zh: boolean; members: TeamMember[]; onDownloadError: (message: string) => void }) {
  const content = <>
    {item.content && <div className="mt-2 text-sm leading-relaxed"><MarkdownContent content={item.content} agentNames={[]} /></div>}
    {(item.from !== null || item.to !== null) && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className="rounded bg-muted px-2 py-1 text-muted-foreground">{humanValue(item.from, zh, members)}</span><span aria-hidden>→</span><span className="rounded bg-muted px-2 py-1 font-medium">{humanValue(item.to, zh, members)}</span></div>}
    {item.changes.length > 0 && <dl className="mt-2 divide-y divide-border rounded-md border border-border text-xs">
      {item.changes.map((change, index) => <div key={`${change.field}-${index}`} className="grid grid-cols-[minmax(90px,0.7fr)_minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 px-3 py-2"><dt className="font-medium">{timelineFieldLabel(change.field, zh)}</dt><dd className="break-words text-muted-foreground">{humanValue(change.from, zh, members)}</dd><span aria-hidden>→</span><dd className="break-words">{humanValue(change.to, zh, members)}</dd></div>)}
    </dl>}
    {item.attachments.length > 0 && <div className="mt-3"><AttachmentList files={item.attachments} onError={onDownloadError} /></div>}
  </>;
  const collapsed = item.actor.type === 'agent' && /thinking|status/i.test(item.kind);
  return collapsed ? <details className="mt-2"><summary className="cursor-pointer text-xs text-muted-foreground">{zh ? '展开 Agent 过程' : 'Show agent process'}</summary>{content}</details> : content;
}

function TimelineEntry({ item, locale, zh, members, onDownloadError }: { item: TaskTimelineItem; locale: string; zh: boolean; members: TeamMember[]; onDownloadError: (message: string) => void }) {
  const kind = timelineKindLabel(item.kind, zh);
  return <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 border-b border-border py-4 last:border-b-0">
    <span className="flex size-7 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground"><EventActorIcon type={item.actor.type} /></span>
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><span className="text-sm font-semibold">{item.actor.name}</span><span className="text-xs text-muted-foreground">{kind}</span><time className="ml-auto text-[11px] text-muted-foreground">{formatDate(item.createdAt, locale, true)}</time></div>
      <EventBody item={item} zh={zh} members={members} onDownloadError={onDownloadError} />
    </div>
  </li>;
}

function CommentComposer({ task, focusRequest, onCreated }: { task: KanbanTask; focusRequest: number; onCreated: (item: TaskTimelineItem) => void }) {
  const api = useWorkspaceApi();
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [draft, setDraft] = useState('');
  const [uploads, setUploads] = useState<CommentUpload[]>([]);
  const [sendError, setSendError] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const uploadSequence = useRef(0);
  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;

  useEffect(() => {
    if (focusRequest > 0) textareaRef.current?.focus();
  }, [focusRequest]);
  useEffect(() => () => {
    uploadsRef.current.forEach((entry) => {
      entry.controller?.abort();
      if (entry.preview && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(entry.preview);
    });
  }, []);

  const upload = useCallback((entry: CommentUpload) => {
    const controller = new AbortController();
    setUploads((current) => current.map((item) => item.key === entry.key ? { ...item, state: 'uploading', progress: 0, error: undefined, controller } : item));
    void api.uploadFile(entry.file, task.channelName ?? undefined, {
      signal: controller.signal,
      onProgress: (progress) => setUploads((current) => current.map((item) => item.key === entry.key ? { ...item, progress } : item)),
    }).then((uploaded) => setUploads((current) => current.map((item) => item.key === entry.key ? { ...item, state: 'uploaded', progress: 1, uploaded, controller: undefined } : item)))
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setUploads((current) => current.map((item) => item.key === entry.key ? { ...item, state: 'error', error: reason instanceof Error ? reason.message : zh ? '上传失败' : 'Upload failed', controller: undefined } : item));
      });
  }, [api, task.channelName, zh]);

  const addFiles = useCallback((list: FileList | File[]) => {
    const entries = Array.from(list).filter((file) => file.size <= MAX_FILE_SIZE).map((file): CommentUpload => ({
      key: `${Date.now()}-${++uploadSequence.current}`,
      file,
      state: 'uploading',
      progress: 0,
      preview: file.type.startsWith('image/') && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined,
    }));
    if (!entries.length && Array.from(list).length) setSendError(zh ? '文件不可超过 50 MB' : 'Files must be 50 MB or smaller');
    setUploads((current) => [...current, ...entries]);
    entries.forEach(upload);
  }, [upload, zh]);

  const removeUpload = (key: string) => setUploads((current) => {
    const found = current.find((entry) => entry.key === key);
    found?.controller?.abort();
    if (found?.preview && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(found.preview);
    return current.filter((entry) => entry.key !== key);
  });

  const submit = async () => {
    const content = draft.trim();
    const uploaded = uploads.filter((entry) => entry.state === 'uploaded' && entry.uploaded).map((entry) => entry.uploaded!.id);
    if ((!content && !uploaded.length) || uploads.some((entry) => entry.state !== 'uploaded')) return;
    setSending(true); setSendError('');
    try {
      const item = await api.addTaskComment(task.id, content, uploaded);
      uploads.forEach((entry) => { if (entry.preview && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(entry.preview); });
      setDraft(''); setUploads([]); onCreated(item);
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : zh ? '评论发送失败，草稿已保留' : 'Comment failed; your draft was kept');
    } finally { setSending(false); }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length) { event.preventDefault(); addFiles(files); }
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  };

  const blocked = sending || uploads.some((entry) => entry.state !== 'uploaded');
  return <div className="rounded-md border border-border bg-background" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
    <label className="sr-only" htmlFor={`task-comment-${task.id}`}>{zh ? '添加评论' : 'Add comment'}</label>
    <textarea id={`task-comment-${task.id}`} ref={textareaRef} value={draft} onChange={(event) => { setDraft(event.target.value); setSendError(''); }} onPaste={onPaste} rows={4} placeholder={zh ? '添加评论' : 'Add comment'} className="block min-h-24 w-full resize-y bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground" />
    {uploads.length > 0 && <ul className="mx-3 mb-3 grid gap-2 sm:grid-cols-2">
      {uploads.map((entry) => <li key={entry.key} className="flex min-w-0 items-center gap-2 rounded-md border border-border p-2 text-xs">
        {entry.preview ? <img src={entry.preview} alt="" className="size-10 shrink-0 rounded object-cover" /> : <FileText className="size-4 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1"><span className="block truncate">{entry.file.name}</span><span className={cn('block text-[10px] text-muted-foreground', entry.state === 'error' && 'text-destructive')}>{entry.state === 'uploading' ? `${zh ? '上传中' : 'Uploading'} ${Math.round(entry.progress * 100)}%` : entry.state === 'error' ? entry.error : (zh ? '已上传' : 'Uploaded')}</span></span>
        {entry.state === 'error' && <button type="button" onClick={() => upload(entry)} aria-label={`${zh ? '重试上传' : 'Retry upload'}: ${entry.file.name}`} title={zh ? '重试上传' : 'Retry upload'} className="flex size-7 items-center justify-center rounded hover:bg-muted"><RefreshCw className="size-3.5" /></button>}
        <button type="button" onClick={() => removeUpload(entry.key)} aria-label={`${zh ? '移除附件' : 'Remove attachment'}: ${entry.file.name}`} title={zh ? '移除附件' : 'Remove attachment'} className="flex size-7 items-center justify-center rounded hover:bg-muted"><X className="size-3.5" /></button>
      </li>)}
    </ul>}
    {sendError && <p role="alert" className="px-4 pb-2 text-xs text-destructive">{sendError}</p>}
    <MarkdownToolbar textareaRef={textareaRef} textareaId={`task-comment-${task.id}`} label={zh ? '评论' : 'Comment'} value={draft} onChange={(value) => { setDraft(value); setSendError(''); }} disabled={sending} />
    <div className="flex items-center gap-0.5 border-t border-border p-2">
      <button type="button" onClick={() => imageRef.current?.click()} title={zh ? '添加图片' : 'Add image'} aria-label={zh ? '添加图片' : 'Add image'} className="flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><ImageIcon className="size-4" /></button>
      <button type="button" onClick={() => fileRef.current?.click()} title={zh ? '添加附件' : 'Add attachment'} aria-label={zh ? '添加附件' : 'Add attachment'} className="flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><Paperclip className="size-4" /></button>
      <input ref={imageRef} type="file" accept="image/*" multiple className="hidden" aria-label={zh ? '选择图片' : 'Choose images'} onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ''; }} />
      <input ref={fileRef} type="file" accept={COMMENT_ACCEPT} multiple className="hidden" aria-label={zh ? '选择附件' : 'Choose attachments'} onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ''; }} />
      <Button size="sm" className="ml-auto" disabled={blocked || (!draft.trim() && !uploads.length)} onClick={() => void submit()}><Send className="size-3.5" />{sending ? (zh ? '发送中' : 'Sending') : (zh ? '评论' : 'Comment')}</Button>
    </div>
  </div>;
}

export function TaskDetailSheet({
  taskId,
  planItem,
  open,
  canManage,
  initialView = 'all',
  onViewChange,
  onOpenChange,
  onChanged,
}: TaskDetailSheetProps) {
  const api = useWorkspaceApi();
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [task, setTask] = useState<KanbanTask | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [review, setReview] = useState<TaskReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [view, setView] = useState<TaskTimelineView>(isTimelineView(initialView) ? initialView : 'all');
  const [actorType, setActorType] = useState<'all' | TaskTimelineActorType>('all');
  const [sort, setSort] = useState<'asc' | 'desc'>('desc');
  const [timeline, setTimeline] = useState<TaskTimelineItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState('');
  const [commentFocus, setCommentFocus] = useState(0);
  const [reviewDecision, setReviewDecision] = useState<'approved' | 'returned' | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const detailGeneration = useRef(0);
  const timelineGeneration = useRef(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const planItemId = planItem?.id ?? null;

  useEffect(() => {
    const next = isTimelineView(initialView) ? initialView : 'all';
    setView(next);
  }, [initialView]);

  const loadDetail = useCallback(async (quiet = false) => {
    if (!open || !taskId || !planItemId) return;
    const generation = ++detailGeneration.current;
    if (!quiet) { setLoading(true); setDetailError(''); setTask(null); }
    try {
      const [nextTask, nextTeam] = await Promise.all([api.getTask(taskId), api.getTeam()]);
      if (generation !== detailGeneration.current) return;
      if (nextTask.planItemId !== planItemId) throw new Error(zh ? '该任务不属于当前计划项' : 'This task does not belong to the selected plan item');
      setTask(nextTask); setTeam(nextTeam); setDetailError('');
      if (canManage && nextTask.status === 'need_input') {
        try {
          const nextReview = await api.getTaskReview(nextTask.id);
          if (generation === detailGeneration.current) setReview(nextReview.reviewState === 'pending' ? nextReview : null);
        } catch {
          if (generation === detailGeneration.current) setReview(null);
        }
      } else setReview(null);
    } catch (reason) {
      if (generation === detailGeneration.current && !quiet) setDetailError(taskError(reason, zh));
    } finally {
      if (generation === detailGeneration.current && !quiet) setLoading(false);
    }
  }, [api, canManage, open, planItemId, taskId, zh]);

  const loadTimeline = useCallback(async (mode: 'replace' | 'merge' | 'more' = 'replace') => {
    if (!open || !taskId || !task) return;
    const generation = ++timelineGeneration.current;
    if (mode !== 'merge') setTimelineLoading(true);
    if (mode === 'replace') setTimelineError('');
    try {
      const page = await api.getTaskTimeline(taskId, {
        category: view,
        actorType: actorType === 'all' ? undefined : actorType,
        sort,
        cursor: mode === 'more' ? nextCursor ?? undefined : undefined,
        limit: 50,
      });
      if (generation !== timelineGeneration.current) return;
      setTimeline((current) => mode === 'replace' ? page.items : mergeTimeline(current, page.items, sort));
      if (mode !== 'merge') setNextCursor(page.nextCursor);
      setTimelineError('');
    } catch (reason) {
      if (generation === timelineGeneration.current) setTimelineError(reason instanceof Error ? reason.message : zh ? '时间线加载失败' : 'Could not load timeline');
    } finally {
      if (generation === timelineGeneration.current && mode !== 'merge') setTimelineLoading(false);
    }
  }, [actorType, api, nextCursor, open, sort, task, taskId, view, zh]);

  useEffect(() => {
    if (!open) return;
    setActorType('all'); setSort('desc'); setTimeline([]); setNextCursor(null); setReview(null); setDownloadError('');
    void loadDetail();
  }, [loadDetail, open, taskId]);

  useEffect(() => {
    if (open && task) void loadTimeline('replace');
    // `loadTimeline` also closes over nextCursor; cursor changes must not restart the first page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id, view, actorType, sort]);

  useEffect(() => {
    if (!open || !task) return;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      void loadDetail(true);
      void loadTimeline('merge');
    };
    const timer = window.setInterval(refresh, 5_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [loadDetail, loadTimeline, open, task]);

  const changeView = (next: string) => {
    if (!isTimelineView(next)) return;
    setView(next); onViewChange?.(next);
  };
  const beginComment = () => {
    setActorType('all'); changeView('comments');
    setCommentFocus((value) => value + 1);
  };
  const commentCreated = (item: TaskTimelineItem) => {
    if (actorType === 'all' || actorType === 'human') setTimeline((current) => mergeTimeline(current, [item], sort));
  };

  const submitReview = async () => {
    if (!review || !reviewDecision || (reviewDecision === 'returned' && !reviewComment.trim())) return;
    setReviewBusy(true); setDetailError('');
    try {
      await api.decideTaskReview(review.taskId, review.submissionVersion, reviewDecision, reviewComment.trim());
      setReviewDecision(null); setReviewComment('');
      await loadDetail(true);
      await loadTimeline('replace');
      await onChanged?.();
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : zh ? '审核失败，请刷新后重试' : 'Review failed; refresh and try again');
      await loadDetail(true);
    } finally { setReviewBusy(false); }
  };

  const ownerName = useMemo(() => {
    if (!task?.responsibleUserId) return zh ? '未分配' : 'Unassigned';
    const member = team.find((entry) => memberId(entry) === task.responsibleUserId);
    return member?.displayName || member?.username || member?.email || task.responsibleUserId;
  }, [task?.responsibleUserId, team, zh]);
  const attachments = useMemo(() => {
    if (!task) return [];
    if (task.attachments?.length) return task.attachments;
    const ids = new Set(task.fileIds);
    return (planItem?.attachments || []).filter((file) => ids.has(file.id));
  }, [planItem?.attachments, task]);
  const stale = Boolean(task?.sourceVersion && planItem && task.sourceVersion < planItem.version);

  return <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-none gap-0 overflow-hidden p-0 sm:w-[min(70vw,1120px)] sm:max-w-[1120px]"
        onOpenAutoFocus={(event) => { event.preventDefault(); requestAnimationFrame(() => titleRef.current?.focus()); }}
      >
        <SheetHeader className="shrink-0 border-b border-border px-5 py-4 pr-14 text-left sm:px-7 sm:py-5 sm:pr-14">
          <p className="truncate text-xs text-muted-foreground">{planItem?.title || (zh ? '计划任务' : 'Plan task')}</p>
          <SheetTitle asChild><h2 ref={titleRef} tabIndex={-1} className="break-words text-lg font-semibold outline-none sm:text-xl">{task?.title || (loading ? (zh ? '正在加载任务…' : 'Loading task…') : (zh ? '任务详情' : 'Task details'))}</h2></SheetTitle>
          <SheetDescription className="sr-only">{zh ? '计划中已分发任务的详细信息和协作时间线' : 'Details and collaboration timeline for a dispatched plan task'}</SheetDescription>
          {task && <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={cn('rounded-sm border px-2 py-1 text-xs font-medium', task.status === 'need_input' && 'border-amber-400/60 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300', task.status === 'done' && 'border-emerald-400/60 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300')}>{statusLabel(task.status, zh)}</span>
            {task.transferUserId && <span className="rounded-sm bg-muted px-2 py-1 text-xs">{zh ? '交接中' : 'Transfer pending'}</span>}
            {review && <div className="ml-auto flex gap-2"><Button variant="outline" size="sm" onClick={() => { setReviewComment(''); setReviewDecision('returned'); }}><RotateCcw className="size-3.5" />{zh ? '退回修改' : 'Return'}</Button><Button size="sm" onClick={() => { setReviewComment(''); setReviewDecision('approved'); }}><Check className="size-3.5" />{zh ? '通过' : 'Approve'}</Button></div>}
          </div>}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && <div role="status" className="space-y-4 px-5 py-8 sm:px-7"><div className="h-20 animate-pulse rounded-md bg-muted" /><div className="h-40 animate-pulse rounded-md bg-muted" /><span className="sr-only">{zh ? '正在加载' : 'Loading'}</span></div>}
          {!loading && detailError && !task && <div role="alert" className="flex min-h-72 flex-col items-center justify-center gap-4 px-6 text-center"><p className="max-w-md text-sm text-destructive">{detailError}</p><Button variant="outline" onClick={() => void loadDetail()}><RefreshCw className="size-4" />{zh ? '重试' : 'Retry'}</Button></div>}
          {!loading && task && <>
            {detailError && <div role="alert" className="mx-5 mt-4 flex items-center gap-2 rounded-md border border-destructive/40 px-3 py-2 text-xs text-destructive sm:mx-7"><span className="min-w-0 flex-1">{detailError}</span><button type="button" onClick={() => void loadDetail()} title={zh ? '重试' : 'Retry'} aria-label={zh ? '重试' : 'Retry'} className="flex size-7 shrink-0 items-center justify-center rounded hover:bg-muted"><RefreshCw className="size-3.5" /></button></div>}
            <section aria-label={zh ? '任务属性' : 'Task properties'} className="grid border-b border-border bg-muted/20 sm:grid-cols-3 xl:grid-cols-5">
              <MetadataCell label={zh ? '优先级' : 'Priority'}>{priorityLabel(task.priority, zh)}</MetadataCell>
              <MetadataCell label={zh ? '负责人' : 'Owner'}>{ownerName}</MetadataCell>
              <MetadataCell label={zh ? '执行方式' : 'Execution'}>{task.workflowId ? `${zh ? '工作流' : 'Workflow'} · ${task.workflowId}` : task.assignee ? `${zh ? 'Agent' : 'Agent'} · ${task.assignee}` : (zh ? '人工执行' : 'Manual')}</MetadataCell>
              <MetadataCell label={zh ? '开始日期' : 'Start date'}>{formatDate(task.startDate, locale)}</MetadataCell>
              <MetadataCell label={zh ? '截止日期' : 'Due date'}>{formatDate(task.dueDate, locale)}</MetadataCell>
            </section>

            <div className="space-y-7 px-5 py-6 sm:px-7">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{zh ? '任务快照' : 'Task snapshot'} v{task.sourceVersion ?? '—'}</span><span aria-hidden>·</span><span>{zh ? '当前计划' : 'Current plan'} v{planItem?.version ?? '—'}</span>{task.executionStatus && <><span aria-hidden>·</span><span>{zh ? '执行状态' : 'Execution'}: {task.executionStatus}</span></>}</div>
              {stale && <div className="rounded-md border border-amber-400/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><p className="font-medium">{zh ? '该任务使用的是较早版本计划' : 'This task uses an older plan version'}</p>{canManage && <p className="mt-1 text-xs opacity-80">{zh ? '请在计划列表中确认变更后，使用“发布变更”同步到仍可更新的任务。' : 'Review the plan changes, then use Publish changes in the plan list to update eligible tasks.'}</p>}</div>}
              {task.tags?.length ? <div className="flex flex-wrap gap-1.5">{task.tags.map((tag) => <span key={tag} className="rounded-sm bg-muted px-2 py-1 text-xs">{tag}</span>)}</div> : null}
              <section><h3 className="mb-2 text-xs font-semibold text-muted-foreground">{zh ? '描述' : 'Description'}</h3>{task.description ? <div className="text-sm"><MarkdownContent content={task.description} agentNames={[]} /></div> : <p className="text-sm text-muted-foreground">{zh ? '无描述' : 'No description'}</p>}</section>
              <section><h3 className="mb-2 text-xs font-semibold text-muted-foreground">{zh ? '验收标准' : 'Acceptance criteria'}</h3>{task.acceptanceCriteria ? <div className="text-sm"><MarkdownContent content={task.acceptanceCriteria} agentNames={[]} /></div> : <p className="text-sm text-muted-foreground">{zh ? '未设置' : 'Not specified'}</p>}</section>
              {attachments.length > 0 && <section><h3 className="mb-2 text-xs font-semibold text-muted-foreground">{zh ? '任务附件' : 'Task attachments'}</h3><AttachmentList files={attachments} onError={setDownloadError} />{downloadError && <p role="alert" className="mt-2 text-xs text-destructive">{downloadError}</p>}</section>}
              {task.submittedSummary && <section className="rounded-md border border-border bg-muted/20 p-4"><h3 className="mb-2 text-xs font-semibold text-muted-foreground">{zh ? '最新提交结果' : 'Latest submission'}</h3><div className="text-sm"><MarkdownContent content={task.submittedSummary} agentNames={[]} /></div></section>}
            </div>

            <section className="border-t border-border" aria-label={zh ? '任务时间线' : 'Task timeline'}>
              <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-5 pt-3 backdrop-blur-sm sm:px-7">
                <div className="flex items-end gap-3 overflow-x-auto">
                  <Tabs value={view} onValueChange={changeView} className="min-w-max"><TabsList variant="line" aria-label={zh ? '时间线分类' : 'Timeline category'}>
                    {TIMELINE_VIEWS.map((tab) => <TabsTrigger key={tab} value={tab} className="px-2.5">{{ all: zh ? '全部' : 'All', activity: zh ? '活动' : 'Activity', comments: zh ? '评论' : 'Comments', transition: zh ? '流转' : 'Transition', history: zh ? '历史' : 'History' }[tab]}</TabsTrigger>)}
                  </TabsList></Tabs>
                </div>
                <div className="flex flex-wrap items-center gap-2 py-3">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground"><span>{zh ? '来源' : 'Source'}</span><select aria-label={zh ? '筛选来源' : 'Filter source'} value={actorType} onChange={(event) => setActorType(event.target.value as typeof actorType)} className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="all">{zh ? '全部' : 'All'}</option><option value="human">{zh ? '成员' : 'Human'}</option><option value="agent">Agent</option><option value="system">{zh ? '系统' : 'System'}</option></select></label>
                  <button type="button" onClick={() => setSort((current) => current === 'desc' ? 'asc' : 'desc')} className="ml-auto flex h-8 items-center gap-1.5 rounded-md border border-input px-2.5 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" title={sort === 'desc' ? (zh ? '当前最新优先，点击改为最早优先' : 'Newest first; switch to oldest first') : (zh ? '当前最早优先，点击改为最新优先' : 'Oldest first; switch to newest first')}>{sort === 'desc' ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />}{sort === 'desc' ? (zh ? '最新优先' : 'Newest') : (zh ? '最早优先' : 'Oldest')}</button>
                  {view === 'all' && <Button variant="outline" size="sm" onClick={beginComment}><MessageSquare className="size-3.5" />{zh ? '添加评论' : 'Add comment'}</Button>}
                </div>
              </div>
              <div className="px-5 pb-8 sm:px-7">
                {view === 'comments' && <div className="py-5"><CommentComposer key={task.id} task={task} focusRequest={commentFocus} onCreated={commentCreated} /></div>}
                {timelineError && <div role="alert" className="mt-4 flex items-center gap-2 rounded-md border border-destructive/40 px-3 py-2 text-xs text-destructive"><span className="min-w-0 flex-1">{timelineError}</span><button type="button" onClick={() => void loadTimeline('replace')} aria-label={zh ? '重新加载时间线' : 'Reload timeline'} title={zh ? '重新加载时间线' : 'Reload timeline'} className="flex size-7 items-center justify-center rounded hover:bg-muted"><RefreshCw className="size-3.5" /></button></div>}
                {timelineLoading && !timeline.length ? <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{zh ? '正在加载时间线…' : 'Loading timeline…'}</div>
                  : timeline.length ? <ul>{timeline.map((item) => <TimelineEntry key={item.id} item={item} locale={locale} zh={zh} members={team} onDownloadError={setDownloadError} />)}</ul>
                    : !timelineError && <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground"><Clock3 className="size-5" /><p className="text-sm">{zh ? '此分类暂无记录' : 'No entries in this category'}</p></div>}
                {nextCursor && <div className="pt-4 text-center"><Button variant="outline" size="sm" disabled={timelineLoading} onClick={() => void loadTimeline('more')}>{timelineLoading ? <Loader2 className="size-3.5 animate-spin" /> : null}{zh ? '加载更多' : 'Load more'}</Button></div>}
              </div>
            </section>
          </>}
        </div>
      </SheetContent>
    </Sheet>

    <Dialog open={Boolean(reviewDecision)} onOpenChange={(next) => { if (!next && !reviewBusy) setReviewDecision(null); }}>
      <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{reviewDecision === 'approved' ? (zh ? '通过任务审核' : 'Approve task') : (zh ? '退回修改' : 'Return for changes')}</DialogTitle><DialogDescription>{task?.title}</DialogDescription></DialogHeader>{reviewDecision === 'returned' && <label className="block space-y-1.5 text-xs font-medium"><span>{zh ? '修改意见' : 'Changes needed'}</span><textarea value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} rows={4} autoFocus className="block w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>}<DialogFooter><Button variant="outline" disabled={reviewBusy} onClick={() => setReviewDecision(null)}>{zh ? '取消' : 'Cancel'}</Button><Button disabled={reviewBusy || (reviewDecision === 'returned' && !reviewComment.trim())} onClick={() => void submitReview()}>{reviewBusy && <Loader2 className="size-3.5 animate-spin" />}{zh ? '确认' : 'Confirm'}</Button></DialogFooter></DialogContent>
    </Dialog>
  </>;
}
