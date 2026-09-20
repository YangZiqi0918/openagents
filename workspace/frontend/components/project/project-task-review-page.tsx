'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, FileText, MessageSquare, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useWorkspaceApi } from '@/lib/workspace-api-context';
import { useWorkspace } from '@/lib/workspace-context';
import type { KanbanTask, TaskReview, TaskReviewSubmission } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/responsive-dialog';
import { TaskChatPopup } from '@/components/tasks/task-chat-popup';

function displayDate(value: string | null, locale: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function decisionLabel(submission: TaskReviewSubmission, zh: boolean) {
  return submission.reviewDecision === 'approved' ? (zh ? '已通过' : 'Approved')
    : submission.reviewDecision === 'returned' ? (zh ? '已退回' : 'Returned')
      : (zh ? '待审核' : 'Awaiting review');
}

export function ProjectTaskReviewPage({ initialTaskId }: { initialTaskId?: string }) {
  const api = useWorkspaceApi();
  const { refreshTasks } = useWorkspace();
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [filter, setFilter] = useState<'pending' | 'processed'>('pending');
  const [items, setItems] = useState<TaskReview[]>([]);
  const [selected, setSelected] = useState<TaskReview | null>(null);
  const [mobileDetail, setMobileDetail] = useState(Boolean(initialTaskId));
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<'approved' | 'returned' | null>(null);
  const [comment, setComment] = useState('');
  const [chatTask, setChatTask] = useState<KanbanTask | null>(null);
  const loadGeneration = useRef(0);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const reload = useCallback(async () => {
    const generation = ++loadGeneration.current;
    try {
      const reviews = await api.listTaskReviews(filter);
      if (generation !== loadGeneration.current) return;
      setItems(reviews);
      setSelected(current => reviews.find(item => item.taskId === current?.taskId) ?? reviews[0] ?? null);
      setError('');
    } catch (reason) {
      if (generation !== loadGeneration.current) return;
      setError(reason instanceof Error ? reason.message : zh ? '审核记录加载失败' : 'Could not load reviews');
    } finally { if (generation === loadGeneration.current) setLoading(false); }
  }, [api, filter, zh]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!initialTaskId) return;
    let active = true;
    void api.getTaskReview(initialTaskId).then(review => {
      if (!active) return;
      setSelected(review);
      setMobileDetail(true);
      if (review.reviewState !== filterRef.current) {
        loadGeneration.current += 1;
        setFilter(review.reviewState);
        setLoading(true);
      }
    }).catch(() => {
      if (active) setError(zh ? '无法打开该审核记录' : 'Could not open this review');
    });
    return () => { active = false; };
  }, [api, initialTaskId, zh]);

  const visible = useMemo(() => items.filter(item =>
    `${item.title} ${item.planTitle ?? ''} ${item.responsibleName ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  ), [items, query]);

  const submitDecision = async () => {
    if (!selected || !decision || (decision === 'returned' && !comment.trim())) return;
    setBusy(true); setError('');
    try {
      await api.decideTaskReview(selected.taskId, selected.submissionVersion, decision, comment.trim());
      setDecision(null); setComment(''); setMobileDetail(false);
      await reload();
      void refreshTasks().catch(() => {});
    } catch (reason) {
      setDecision(null);
      await reload();
      setError(reason instanceof Error ? reason.message : zh ? '审核失败，请刷新后重试' : 'Review failed; refresh and try again');
    } finally { setBusy(false); }
  };

  const openChat = async () => {
    if (!selected?.channelName) return;
    setError('');
    try { setChatTask(await api.getTask(selected.taskId)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : zh ? '无法打开任务对话' : 'Could not open task conversation'); }
  };

  return <div data-testid="project-task-review-page" className="flex min-h-0 flex-1 flex-col bg-background px-5 pb-8 pt-5 text-foreground sm:px-8 lg:px-10">
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">{zh ? '任务审核' : 'Task reviews'}</h2>
      <Button variant="ghost" mode="icon" size="sm" onClick={() => void reload()} title={zh ? '刷新审核' : 'Refresh reviews'} aria-label={zh ? '刷新审核' : 'Refresh reviews'}><RefreshCw className="size-4" /></Button>
    </div>
    {error && <p role="alert" className="mb-3 rounded-md border border-destructive/40 px-3 py-2 text-xs text-destructive">{error}</p>}
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div role="tablist" aria-label={zh ? '审核状态' : 'Review status'} className="flex gap-1">
        {(['pending', 'processed'] as const).map(value => <button key={value} role="tab" type="button" aria-selected={filter === value} onClick={() => { setFilter(value); setLoading(true); setSelected(null); setMobileDetail(false); }} className={`rounded-md border px-3 py-1.5 text-xs font-medium ${filter === value ? 'border-border bg-muted text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/60'}`}>{value === 'pending' ? (zh ? '待审核' : 'Pending') : (zh ? '已处理' : 'Processed')}</button>)}
      </div>
      <label className="flex h-8 items-center gap-2 rounded-md border border-input px-2.5 text-muted-foreground"><Search className="size-3.5" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={zh ? '搜索任务或负责人' : 'Search tasks or members'} aria-label={zh ? '搜索任务或负责人' : 'Search tasks or members'} className="w-36 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground sm:w-44" /></label>
    </div>
    <div className="grid min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-background md:grid-cols-[minmax(0,1.15fr)_minmax(330px,0.85fr)]">
      <div className={`${mobileDetail ? 'hidden md:block' : ''} min-w-0 overflow-auto md:border-r md:border-border`}>
        <div className="grid grid-cols-[minmax(0,1fr)_80px_85px_65px] gap-2 border-b border-border px-4 py-3 text-xs text-muted-foreground max-sm:grid-cols-[minmax(0,1fr)_65px] max-sm:[&>span:nth-child(2)]:hidden max-sm:[&>span:nth-child(3)]:hidden"><span>{zh ? '任务 / 所属计划' : 'Task / Plan'}</span><span>{zh ? '负责人' : 'Owner'}</span><span>{zh ? '提交时间' : 'Submitted'}</span><span className="text-right">{zh ? '状态' : 'Status'}</span></div>
        {loading ? <p role="status" className="px-4 py-12 text-center text-sm text-muted-foreground">{zh ? '正在加载审核记录…' : 'Loading reviews…'}</p>
          : visible.length ? visible.map(item => <button key={item.taskId} type="button" aria-current={selected?.taskId === item.taskId ? 'true' : undefined} onClick={() => { setSelected(item); setMobileDetail(true); }} className={`grid min-h-20 w-full grid-cols-[minmax(0,1fr)_80px_85px_65px] items-center gap-2 border-b border-border px-4 py-3 text-left text-xs transition-colors hover:bg-muted/50 max-sm:grid-cols-[minmax(0,1fr)_65px] ${selected?.taskId === item.taskId ? 'bg-muted/70' : ''}`}><span className="min-w-0"><span className="block truncate text-sm font-medium">{item.title}</span><span className="mt-1 block truncate text-muted-foreground">{item.planTitle || (zh ? '项目任务' : 'Project task')} · {item.submission.summary}</span></span><span className="truncate max-sm:hidden">{item.responsibleName || '—'}</span><span className="whitespace-nowrap text-muted-foreground max-sm:hidden">{displayDate(item.submission.submittedAt, locale)}</span><span className={`text-right whitespace-nowrap ${item.reviewState === 'pending' ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}`}>{decisionLabel(item.submission, zh)}</span></button>)
            : <p className="px-4 py-12 text-center text-sm text-muted-foreground">{query ? (zh ? '没有匹配的审核记录' : 'No matching reviews') : filter === 'pending' ? (zh ? '暂无待审核任务' : 'No pending reviews') : (zh ? '暂无已处理记录' : 'No processed reviews')}</p>}
      </div>
      <div className={`${mobileDetail ? '' : 'hidden md:block'} min-h-0 min-w-0 overflow-auto`}>
        {selected ? <div className="flex min-h-full flex-col">
          <div className="border-b border-border px-5 py-4"><button type="button" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground md:hidden" onClick={() => setMobileDetail(false)}><ArrowLeft className="size-4" />{zh ? '返回列表' : 'Back to list'}</button><p className="mb-1 text-xs text-muted-foreground">{selected.planTitle || (zh ? '项目任务' : 'Project task')}</p><h3 className="break-words text-sm font-semibold">{selected.title}</h3></div>
          <div className="flex-1 px-5"><div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-border py-4 text-xs"><span className="text-muted-foreground">{zh ? '负责人' : 'Owner'} <span className="text-foreground">{selected.responsibleName || '—'}</span></span><span className="text-muted-foreground">{zh ? '提交' : 'Submitted'} <span className="text-foreground">{displayDate(selected.submission.submittedAt, locale)}</span></span></div>
            <section className="border-b border-border py-4"><h4 className="mb-2 text-xs font-medium text-muted-foreground">{zh ? '验收标准' : 'Acceptance criteria'}</h4><p className="whitespace-pre-wrap break-words text-sm">{selected.acceptanceCriteria || (zh ? '未设置' : 'Not specified')}</p></section>
            <section className="border-b border-border py-4"><h4 className="mb-2 text-xs font-medium text-muted-foreground">{zh ? '提交结果' : 'Submitted result'}</h4><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{selected.submission.summary}</p></section>
            <section className="border-b border-border py-4"><h4 className="mb-2 text-xs font-medium text-muted-foreground">{zh ? '提交附件' : 'Attachments'}</h4>{selected.files.length ? <ul className="divide-y divide-border">{selected.files.map(file => <li key={file.id}><button type="button" onClick={() => void api.downloadFile(file.id, file.filename).catch(reason => setError(reason instanceof Error ? reason.message : zh ? '下载失败' : 'Download failed'))} className="flex w-full items-center gap-2 py-2 text-left text-xs hover:underline"><FileText className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 break-all">{file.filename}</span><span className="shrink-0 text-muted-foreground">{Math.ceil(file.size / 1024)} KB</span></button></li>)}</ul> : <p className="text-xs text-muted-foreground">{zh ? '无附件' : 'No attachments'}</p>}</section>
            <section className="py-4"><h4 className="mb-2 text-xs font-medium text-muted-foreground">{zh ? '提交与审核记录' : 'Submission history'}</h4><ol className="space-y-3">{selected.submissionHistory.map((submission, index) => <li key={index} className="border-l-2 border-border pl-3 text-xs"><p className="font-medium">{zh ? `第 ${index + 1} 次提交` : `Submission ${index + 1}`} · {displayDate(submission.submittedAt, locale)}</p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{submission.summary}</p>{submission.reviewDecision && <p className="mt-1">{decisionLabel(submission, zh)} · {submission.reviewerName || submission.reviewedByUserId || '—'} · {displayDate(submission.reviewedAt, locale)}{submission.reviewComment ? ` · ${submission.reviewComment}` : ''}</p>}</li>)}</ol></section>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3"><Button variant="ghost" size="sm" className="mr-auto" disabled={!selected.channelName} onClick={() => void openChat()}><MessageSquare className="size-3.5" />{zh ? '任务对话' : 'Task conversation'}</Button>{selected.reviewState === 'pending' && <><Button variant="outline" size="sm" disabled={busy} onClick={() => { setComment(''); setDecision('returned'); }}><RotateCcw className="size-3.5" />{zh ? '退回修改' : 'Return'}</Button><Button size="sm" disabled={busy} onClick={() => { setComment(''); setDecision('approved'); }}><Check className="size-3.5" />{zh ? '通过审核' : 'Approve'}</Button></>}</div>
        </div> : <p className="px-5 py-12 text-center text-sm text-muted-foreground">{zh ? '选择一条记录查看详情' : 'Select a review to see details'}</p>}
      </div>
    </div>
    <Dialog open={Boolean(decision)} onOpenChange={open => { if (!open && !busy) setDecision(null); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{decision === 'approved' ? (zh ? '通过审核' : 'Approve task') : (zh ? '退回修改' : 'Return for changes')}</DialogTitle><DialogDescription>{selected?.title}</DialogDescription></DialogHeader>{decision === 'returned' && <label className="block space-y-1.5 text-xs font-medium"><span>{zh ? '修改意见' : 'Changes needed'}</span><textarea value={comment} onChange={event => setComment(event.target.value)} rows={4} className="block w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm" /></label>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDecision(null)}>{zh ? '取消' : 'Cancel'}</Button><Button disabled={busy || (decision === 'returned' && !comment.trim())} onClick={() => void submitDecision()}>{zh ? '确认' : 'Confirm'}</Button></DialogFooter></DialogContent></Dialog>
    {chatTask?.channelName && <TaskChatPopup key={chatTask.id} open onOpenChange={open => { if (!open) setChatTask(null); }} sessionId={chatTask.channelName} taskId={chatTask.id} taskTitle={chatTask.title} description={chatTask.description} acceptanceCriteria={chatTask.acceptanceCriteria} assignee={chatTask.assignee} submittedSummary={chatTask.submittedSummary} submissionHistory={chatTask.submissionHistory} />}
  </div>;
}
