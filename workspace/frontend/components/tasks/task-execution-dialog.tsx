'use client';

import { useState } from 'react';
import type { KanbanTask } from '@/lib/types';
import { useWorkspace } from '@/lib/workspace-context';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/responsive-dialog';
import { AttachmentPicker, KnowledgeContextPicker } from './new-task-dialog';

export interface TaskExecutionConfig {
  mode: 'manual' | 'agent' | 'workflow';
  agent?: string;
  workflowId?: string;
  knowledgeIds: string[];
  fileIds: string[];
}

export function TaskExecutionDialog({ task, onClose, onSave, busy }: {
  task: KanbanTask;
  onClose: () => void;
  onSave: (config: TaskExecutionConfig) => Promise<void>;
  busy: boolean;
}) {
  const { agents, workflows, me } = useWorkspace();
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [mode, setMode] = useState<TaskExecutionConfig['mode']>(task.workflowId ? 'workflow' : task.assignee ? 'agent' : 'manual');
  const [agent, setAgent] = useState(task.assignee ?? '');
  const [workflowId, setWorkflowId] = useState(task.workflowId ?? '');
  const [knowledgeIds, setKnowledgeIds] = useState(task.knowledgeIds);
  const [fileIds, setFileIds] = useState(task.fileIds);
  const identity = [me?.userId, me?.email, me?.username].filter(Boolean);
  const supported = workflows.filter((workflow) => workflow.steps.every((step) => step.assignee.kind !== 'human'
    || !step.assignee.human || identity.some((value) => value?.toLowerCase() === step.assignee.human?.toLowerCase())));
  const valid = mode === 'manual' || (mode === 'agent' ? Boolean(agent) : supported.some((workflow) => workflow.id === workflowId));

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="sm:max-w-lg">
    <DialogHeader className="px-6 pt-6"><DialogTitle>{zh ? '配置任务执行' : 'Configure execution'}</DialogTitle></DialogHeader>
    <DialogBody className="space-y-4 px-6 py-4">
      <p className="text-sm font-medium">{task.title}</p>
      <fieldset className="space-y-2"><legend className="text-xs font-medium text-muted-foreground">{zh ? '执行方式' : 'Execution mode'}</legend><div className="grid grid-cols-3 gap-1 rounded-md border border-border p-1">{(['manual', 'agent', 'workflow'] as const).map((value) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)} className={`min-h-9 rounded-sm px-1 text-xs ${mode === value ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{zh ? ({manual:'手动',agent:'智能体',workflow:'工作流'}[value]) : ({manual:'Manual',agent:'Agent',workflow:'Workflow'}[value])}</button>)}</div></fieldset>
      {mode === 'agent' && <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">{zh ? '项目智能体' : 'Project agent'}<select value={agent} onChange={(event) => setAgent(event.target.value)} className="block h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"><option value="">{zh ? '选择智能体' : 'Select agent'}</option>{agents.map((item) => <option key={item.agentName} value={item.agentName}>{item.displayName || item.agentName}{item.status !== 'online' ? ` (${zh ? '离线' : 'offline'})` : ''}</option>)}</select></label>}
      {mode === 'workflow' && <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">{zh ? '项目工作流' : 'Project workflow'}<select value={workflowId} onChange={(event) => setWorkflowId(event.target.value)} className="block h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"><option value="">{zh ? '选择工作流' : 'Select workflow'}</option>{supported.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span className="block font-normal">{zh ? '只列出人工步骤由本人处理的工作流。' : 'Only workflows whose human steps are assigned to you are available.'}</span></label>}
      <KnowledgeContextPicker value={knowledgeIds} onChange={setKnowledgeIds} />
      <AttachmentPicker value={fileIds} onChange={setFileIds} />
    </DialogBody><DialogFooter className="px-6 pb-6"><Button variant="outline" disabled={busy} onClick={onClose}>{zh ? '取消' : 'Cancel'}</Button><Button disabled={!valid || busy} onClick={() => void onSave({ mode, agent: mode === 'agent' ? agent : undefined, workflowId: mode === 'workflow' ? workflowId : undefined, knowledgeIds, fileIds })}>{busy ? (zh ? '保存中' : 'Saving') : (zh ? '保存配置' : 'Save configuration')}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
