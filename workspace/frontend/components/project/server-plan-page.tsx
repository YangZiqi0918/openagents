'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Check, Loader2, Paperclip, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useWorkspaceApi } from '@/lib/workspace-api-context';
import type { ProjectPlanItem, TeamMember } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/responsive-dialog';
import { PlanRecordDialog } from './plan-record-dialog';
import { newPlanRecord, readPlanRecords, uniqueTags, type Assignee, type PlanRecord } from './plan-record-model';

const humanId = (member: TeamMember) => member.userId ?? member.id ?? '';
const canReceive = (member: TeamMember) => member.role !== 'viewer' && Boolean(humanId(member));

function planTaskStatus(status: string, zh: boolean) {
  const labels = zh
    ? { backlog: '待接收', in_progress: '进行中', need_input: '待审核', done: '已完成' }
    : { backlog: 'To accept', in_progress: 'In progress', need_input: 'Awaiting review', done: 'Done' };
  return labels[status as keyof typeof labels] ?? status;
}

function ReadOnlyPlanDetail({ item, onClose, zh }: { item: ProjectPlanItem; onClose: () => void; zh: boolean }) {
  const api = useWorkspaceApi();
  const [downloadError, setDownloadError] = useState('');
  const priority = item.priority
    ? (zh ? { urgent: '紧急', high: '高', medium: '中', low: '低' } : { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' })[item.priority]
    : (zh ? '未设置' : 'Not set');

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader><DialogTitle className="break-words">{item.title}</DialogTitle><DialogDescription className="sr-only">{zh ? '计划项详情' : 'Plan item details'}</DialogDescription></DialogHeader>
      <DialogBody className="max-h-[65dvh] space-y-5 pb-6 text-sm">
        <section><h3 className="mb-1 text-xs font-semibold text-muted-foreground">{zh ? '描述' : 'Description'}</h3><p className="whitespace-pre-wrap break-words">{item.description || (zh ? '无' : 'None')}</p></section>
        <div className="grid grid-cols-2 gap-4 border-y border-border py-3 text-xs sm:grid-cols-3">
          <div><span className="text-muted-foreground">{zh ? '优先级' : 'Priority'}</span><p className="mt-1 font-medium">{priority}</p></div>
          <div><span className="text-muted-foreground">{zh ? '开始日期' : 'Start date'}</span><p className="mt-1 font-medium">{item.startDate || '—'}</p></div>
          <div><span className="text-muted-foreground">{zh ? '截止日期' : 'Due date'}</span><p className="mt-1 font-medium">{item.dueDate || '—'}</p></div>
        </div>
        {item.tags.length > 0 && <section><h3 className="mb-2 text-xs font-semibold text-muted-foreground">{zh ? '标签' : 'Tags'}</h3><div className="flex flex-wrap gap-1.5">{item.tags.map((tag) => <span key={tag} className="rounded-sm bg-muted px-2 py-1 text-xs">{tag}</span>)}</div></section>}
        {item.acceptanceCriteria && <section><h3 className="mb-1 text-xs font-semibold text-muted-foreground">{zh ? '验收标准' : 'Acceptance criteria'}</h3><p className="whitespace-pre-wrap break-words">{item.acceptanceCriteria}</p></section>}
        {item.assignees.length > 0 && <section><h3 className="mb-1 text-xs font-semibold text-muted-foreground">{zh ? '计划处理人' : 'Plan assignees'}</h3><p className="break-words">{item.assignees.map((assignee) => assignee.name).join('、')}</p></section>}
        {item.attachments.length > 0 && <section><h3 className="mb-1 text-xs font-semibold text-muted-foreground">{zh ? '附件' : 'Attachments'}</h3><ul className="divide-y divide-border">{item.attachments.map((file) => <li key={file.id}><button type="button" className="flex w-full items-center gap-2 py-2 text-left text-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => void api.downloadFile(file.id, file.filename).catch((error: unknown) => setDownloadError(error instanceof Error ? error.message : zh ? '下载失败' : 'Download failed'))}><Paperclip className="size-4 shrink-0" /><span className="min-w-0 break-all">{file.filename}</span></button></li>)}</ul>{downloadError && <p role="alert" className="text-xs text-destructive">{downloadError}</p>}</section>}
        {item.tasks.length > 0 && <section><h3 className="mb-1 text-xs font-semibold text-muted-foreground">{zh ? '成员进度' : 'Member progress'}</h3><ul className="divide-y divide-border">{item.tasks.map((task) => <li key={task.id} className="flex justify-between gap-3 py-2"><span className="min-w-0 truncate">{task.responsibleName || task.responsibleUserId || '—'}</span><span className="shrink-0 text-muted-foreground">{task.transferUserId ? (zh ? '交接中' : 'Transfer pending') : task.declineReason ? (zh ? '已拒绝' : 'Declined') : planTaskStatus(task.status, zh)}</span></li>)}</ul></section>}
      </DialogBody>
    </DialogContent>
  </Dialog>;
}

export function ServerPlanPage({ storageKey, focusItemId, canManage }: { storageKey: string; focusItemId?: string; canManage: boolean }) {
  const api = useWorkspaceApi();
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [items, setItems] = useState<ProjectPlanItem[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ProjectPlanItem | 'new' | null>(null);
  const [viewing, setViewing] = useState<ProjectPlanItem | null>(null);
  const [importPreview, setImportPreview] = useState<PlanRecord[] | null>(null);
  const [transfer, setTransfer] = useState<{ taskId: string; ownerId: string } | null>(null);
  const [transferUserId, setTransferUserId] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [forceTransfer, setForceTransfer] = useState(false);
  const [dispatching, setDispatching] = useState<ProjectPlanItem | null>(null);

  useEffect(() => {
    if (!canManage) {
      setEditing(null);
      setImportPreview(null);
      setTransfer(null);
      setDispatching(null);
    }
  }, [canManage]);

  const reload = useCallback(async () => {
    try {
      const [nextItems, nextTeam] = await Promise.all([api.listPlanItems(), api.getTeam()]);
      setItems(nextItems);
      setTeam(nextTeam);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : zh ? '计划加载失败' : 'Could not load the plan');
    } finally {
      setLoading(false);
    }
  }, [api, zh]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const refreshVisible = () => { if (document.visibilityState === 'visible') void reload(); };
    const timer = window.setInterval(refreshVisible, 12_000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshVisible); };
  }, [reload]);
  useEffect(() => {
    if (!loading && focusItemId && items.some((item) => item.id === focusItemId)) {
      document.getElementById(`plan-${focusItemId}`)?.scrollIntoView({ block: 'center' });
    }
  }, [loading, focusItemId, items]);

  const members = useMemo(() => ({
    options: team.filter(canReceive).map((member): Assignee => ({
      id: `human:${humanId(member)}`,
      name: member.username || member.displayName || member.email,
      avatarUrl: member.avatarUrl,
      kind: 'human',
    })),
    loading, error: false,
  }), [team, loading]);

  const save = async (record: PlanRecord): Promise<boolean> => {
    if (!canManage) return false;
    try {
      if (record.assignees.some((assignee) => assignee.kind !== 'human' || !members.options.some((member) => member.id === assignee.id))) {
        setError(zh ? '请移除已离组成员或智能体处理人后保存' : 'Remove former members or agent assignees before saving');
        return false;
      }
      const input = {
        title: record.title, description: record.description, status: record.status,
        assignees: record.assignees,
        priority: record.priority, tags: record.tags, startDate: record.startDate,
        dueDate: record.dueDate, attachments: record.attachments,
        acceptanceCriteria: record.acceptanceCriteria ?? '',
      };
      const result = editing && editing !== 'new'
        ? await api.updatePlanItem(editing.id, { ...input, version: editing.version })
        : await api.createPlanItem(input);
      setItems((current) => editing && editing !== 'new'
        ? current.map((item) => item.id === result.id ? result : item)
        : [...current, result]);
      setError('');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : zh ? '保存计划失败' : 'Could not save the plan');
      return false;
    }
  };

  const dispatch = async (item: ProjectPlanItem) => {
    if (!canManage) return;
    const assignedIds = new Set(item.tasks.map((task) => task.dispatchedUserId ?? task.responsibleUserId));
    const userIds = item.assignees
      .filter((assignee) => assignee.kind === 'human' && assignee.id.startsWith('human:'))
      .map((assignee) => assignee.id.slice(6))
      .filter((id) => !assignedIds.has(id) && team.some((member) => humanId(member) === id && canReceive(member)));
    if (!userIds.length) return;
    setBusy(true);
    try {
      await api.dispatchPlanItem(item.id, userIds, item.version);
      await reload();
      setDispatching(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : zh ? '派发失败' : 'Dispatch failed');
    } finally { setBusy(false); }
  };

  const previewOldPlan = () => {
    try {
      const old = readPlanRecords(localStorage.getItem(storageKey));
      const alreadyImported = new Set(JSON.parse(localStorage.getItem(`${storageKey}:imported`) || '[]') as string[]);
      setImportPreview(old.filter((row) => !alreadyImported.has(row.id)));
      setError('');
    } catch {
      setError(zh ? '本地计划无法读取，原数据保持不变' : 'Local plan could not be read. Nothing was changed.');
    }
  };

  const importOldPlan = async () => {
    if (!canManage) return;
    if (!importPreview?.length) return;
    setBusy(true);
    const imported = new Set(JSON.parse(localStorage.getItem(`${storageKey}:imported`) || '[]') as string[]);
    try {
      for (const row of importPreview) {
        if (imported.has(row.id)) continue;
        const assignees = row.assignees.flatMap((assignee) => {
          if (assignee.kind !== 'human') return [];
          const email = assignee.id.startsWith('human:') ? assignee.id.slice(6) : '';
          const found = team.find((member) => member.email === email && canReceive(member));
          return found ? [{ id: `human:${humanId(found)}`, name: found.username || found.displayName || found.email, kind: 'human' as const }] : [];
        });
        await api.createPlanItem({
          title: row.title, description: row.description, status: row.status, assignees,
          priority: row.priority, tags: row.tags, startDate: row.startDate, dueDate: row.dueDate,
          attachments: row.attachments, acceptanceCriteria: row.acceptanceCriteria ?? '',
        });
        imported.add(row.id);
        localStorage.setItem(`${storageKey}:imported`, JSON.stringify(Array.from(imported)));
      }
      setImportPreview(null);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : zh ? '导入未完成，可重试' : 'Import was interrupted. You can retry.');
      setImportPreview((current) => current?.filter((row) => !imported.has(row.id)) ?? null);
      await reload();
    } finally { setBusy(false); }
  };

  const change = async (action: () => Promise<unknown>) => {
    if (!canManage) return false;
    setBusy(true);
    try { await action(); await reload(); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : zh ? '操作失败' : 'Action failed'); return false; }
    finally { setBusy(false); }
  };

  return (
    <div data-testid="project-plan-page" className="flex min-h-0 flex-1 flex-col bg-background px-5 pb-8 pt-5 sm:px-8 lg:px-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{zh ? '项目计划' : 'Project plan'}</h2>
        <div className="flex items-center gap-2">
          <Button variant="ghost" mode="icon" size="sm" aria-label={zh ? '刷新计划' : 'Refresh plan'} title={zh ? '刷新计划' : 'Refresh plan'} disabled={busy} onClick={() => void reload()}><RefreshCw className="size-4" /></Button>
          {canManage && <><Button variant="outline" size="sm" onClick={previewOldPlan} disabled={busy}>{zh ? '导入本地计划' : 'Import local plan'}</Button>
          <Button size="sm" onClick={() => setEditing('new')} disabled={busy}><Plus className="size-4" />{zh ? '新建计划项' : 'New plan item'}</Button></>}
        </div>
      </div>
      {error && <div role="alert" className="mb-3 flex items-center justify-between gap-2 rounded border border-destructive/40 px-3 py-2 text-sm text-destructive"><span>{error}</span><Button variant="ghost" size="sm" onClick={() => void reload()}>{zh ? '重试' : 'Retry'}</Button></div>}
      {loading ? <div role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{zh ? '正在加载计划' : 'Loading plan'}</div>
        : <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
          <table className={`w-full border-collapse text-left text-sm ${canManage ? 'min-w-[700px]' : 'min-w-[520px]'}`}>
            <thead className="sticky top-0 z-10 bg-background"><tr className="border-b border-border text-muted-foreground"><th className="px-4 py-3 font-medium">{zh ? '计划项' : 'Plan item'}</th><th className="w-[360px] px-4 py-3 font-medium">{zh ? '成员任务' : 'Member tasks'}</th>{canManage && <th className="w-[210px] px-4 py-3 text-right font-medium">{zh ? '操作' : 'Actions'}</th>}</tr></thead>
            <tbody>
              {items.map((item) => {
                const pendingMembers = item.assignees.filter((member) => member.kind === 'human' && !item.tasks.some((task) => `human:${task.dispatchedUserId ?? task.responsibleUserId}` === member.id));
                const changed = item.tasks.filter((task) => task.sourceVersion < item.version && (task.status === 'backlog' || task.status === 'in_progress'));
                return <tr key={item.id} id={`plan-${item.id}`} data-testid="server-plan-item" className={`border-b border-border align-top last:border-0 ${focusItemId === item.id ? 'bg-amber-500/10' : ''}`}>
                  <td className="px-4 py-3"><button type="button" className="text-left font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => canManage ? setEditing(item) : setViewing(item)}>{item.title}</button>{item.tasks.length > 0 && <span className="ml-2 text-xs text-muted-foreground">{item.tasks.filter((task) => task.status === 'done').length}/{item.tasks.length} · {item.tasks.some((task) => task.status === 'need_input') ? (zh ? '待审核' : 'Awaiting review') : item.status === 'doing' ? (zh ? '进行中' : 'In progress') : item.status === 'done' ? (zh ? '已完成' : 'Done') : (zh ? '待接收' : 'To accept')}</span>}<p className="mt-1 line-clamp-2 max-w-xl text-xs text-muted-foreground">{item.description}</p>{item.acceptanceCriteria && <p className="mt-1 text-xs text-muted-foreground">{zh ? '验收：' : 'Acceptance: '}{item.acceptanceCriteria}</p>}</td>
                  <td className="px-4 py-3"><div className="space-y-1.5">{item.tasks.map((task) => <div key={task.id} className="flex items-center justify-between gap-2 text-xs"><span className="truncate">{task.responsibleName || team.find((member) => humanId(member) === task.responsibleUserId)?.displayName || task.responsibleUserId}</span><div className="flex shrink-0 items-center gap-1"><span className={task.status === 'need_input' ? 'font-semibold text-rose-600' : 'text-muted-foreground'}>{task.transferUserId ? (zh ? '交接中' : 'Transfer pending') : task.declineReason ? (zh ? '已拒绝' : 'Declined') : planTaskStatus(task.status, zh)}</span>{canManage && task.status !== 'done' && !task.transferUserId && <button type="button" className="rounded p-1 text-muted-foreground hover:text-foreground" title={zh ? '交接' : 'Transfer'} aria-label={`${zh ? '交接' : 'Transfer'} ${task.responsibleName || task.id}`} onClick={() => { setTransfer({ taskId: task.id, ownerId: task.responsibleUserId ?? '' }); setTransferUserId(''); setTransferReason(''); setForceTransfer(false); }}><ArrowRightLeft className="size-3.5" /></button>}</div></div>)}{!item.tasks.length && <span className="text-xs text-muted-foreground">{zh ? '尚未派发' : 'Not dispatched'}</span>}</div></td>
                  {canManage && <td className="space-y-1 px-4 py-3 text-right"><div className="flex flex-wrap justify-end gap-1"><Button size="sm" variant="outline" disabled={busy || !pendingMembers.length} onClick={() => setDispatching(item)}><Send className="size-3.5" />{zh ? '派发' : 'Dispatch'}{pendingMembers.length ? ` (${pendingMembers.length})` : ''}</Button><Button size="sm" variant="ghost" disabled={busy || !changed.length} title={zh ? '向执行中的任务发布更改' : 'Publish changes to active tasks'} onClick={() => void change(() => api.publishPlanItem(item.id, changed.map((task) => task.id), item.version))}><Check className="size-3.5" />{zh ? '发布变更' : 'Publish changes'}</Button>{!item.tasks.length && <Button size="sm" variant="ghost" mode="icon" disabled={busy} title={zh ? '删除计划项' : 'Delete plan item'} aria-label={`${zh ? '删除' : 'Delete'} ${item.title}`} onClick={() => { if (window.confirm(zh ? `删除“${item.title}”？` : `Delete “${item.title}”?`)) void change(() => api.deletePlanItem(item.id)); }}><Trash2 className="size-3.5" /></Button>}</div></td>}
                </tr>;
              })}
              {!items.length && <tr><td colSpan={canManage ? 3 : 2} className="px-4 py-12 text-center text-sm text-muted-foreground">{zh ? '暂无计划项' : 'No plan items'}</td></tr>}
            </tbody>
          </table>
        </div>}
      {viewing && <ReadOnlyPlanDetail item={items.find((item) => item.id === viewing.id) ?? viewing} onClose={() => setViewing(null)} zh={zh} />}
      {canManage && editing && <PlanRecordDialog key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? newPlanRecord() : editing} editing={editing !== 'new'} members={members} tagOptions={uniqueTags(items.flatMap((item) => item.tags))} canUpload onSave={save} onClose={() => setEditing(null)} />}
      {canManage && <><Dialog open={Boolean(dispatching)} onOpenChange={(open) => !open && setDispatching(null)}><DialogContent><DialogHeader><DialogTitle>{zh ? '派发任务' : 'Dispatch tasks'}</DialogTitle><DialogDescription>{zh ? '按计划中的处理人为每名成员创建独立任务；派发不会启动智能体。' : 'Create one independent task per assignee. AI will not start automatically.'}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDispatching(null)}>{zh ? '取消' : 'Cancel'}</Button><Button disabled={busy} onClick={() => dispatching && void dispatch(dispatching)}>{zh ? '确认派发' : 'Dispatch'}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(importPreview)} onOpenChange={(open) => !open && setImportPreview(null)}><DialogContent><DialogHeader><DialogTitle>{zh ? '导入本地计划草稿' : 'Import local plan drafts'}</DialogTitle><DialogDescription>{zh ? `找到 ${importPreview?.length ?? 0} 条尚未导入的记录。请确认后导入；旧记录保留，智能体处理人不自动派发。` : `Found ${importPreview?.length ?? 0} records not imported yet. Original data remains; agent assignees are not dispatched.`}</DialogDescription></DialogHeader><div className="max-h-48 overflow-auto text-sm">{importPreview?.map((record) => <p key={record.id} className="border-b px-1 py-1.5">{record.title}</p>)}</div><DialogFooter><Button variant="outline" onClick={() => setImportPreview(null)}>{zh ? '取消' : 'Cancel'}</Button><Button disabled={busy || !importPreview?.length} onClick={() => void importOldPlan()}>{zh ? '导入为草稿' : 'Import as drafts'}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(transfer)} onOpenChange={(open) => !open && setTransfer(null)}><DialogContent><DialogHeader><DialogTitle>{zh ? '交接任务' : 'Transfer task'}</DialogTitle><DialogDescription>{zh ? '接手人确认后，原任务及历史进入其待办池。' : 'After acceptance, the existing task and history move to the new owner’s pool.'}</DialogDescription></DialogHeader><div className="space-y-3"><label className="block space-y-1 text-xs font-medium">{zh ? '接手成员' : 'New owner'}<select className="block h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={transferUserId} onChange={(event) => setTransferUserId(event.target.value)}><option value="">{zh ? '选择成员' : 'Select member'}</option>{team.filter((member) => canReceive(member) && humanId(member) !== transfer?.ownerId).map((member) => <option key={humanId(member)} value={humanId(member)}>{member.username || member.displayName || member.email}</option>)}</select></label><label className="block space-y-1 text-xs font-medium">{zh ? '交接原因' : 'Reason'}<Input value={transferReason} onChange={(event) => setTransferReason(event.target.value)} /></label>{transfer && !team.some((member) => humanId(member) === transfer.ownerId) && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={forceTransfer} onChange={(event) => setForceTransfer(event.target.checked)} />{zh ? '原负责人已离组，强制交接' : 'Original owner left; force transfer'}</label>}</div><DialogFooter><Button variant="outline" onClick={() => setTransfer(null)}>{zh ? '取消' : 'Cancel'}</Button><Button disabled={busy || !transferUserId || !transferReason.trim()} onClick={() => { if (!transfer) return; void change(() => api.transferTask(transfer.taskId, transferUserId, transferReason.trim(), forceTransfer)).then((saved) => { if (saved) setTransfer(null); }); }}>{zh ? '发起交接' : 'Start transfer'}</Button></DialogFooter></DialogContent></Dialog></>}
    </div>
  );
}
