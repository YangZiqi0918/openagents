// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { KanbanTask, ProjectPlanItem, TaskReview, TaskTimelineItem } from '@/lib/types';
import { TaskDetailSheet, type TaskTimelineView } from './task-detail-sheet';

const mock = vi.hoisted(() => ({
  getTask: vi.fn(),
  getTeam: vi.fn(),
  getTaskReview: vi.fn(),
  getTaskTimeline: vi.fn(),
  addTaskComment: vi.fn(),
  decideTaskReview: vi.fn(),
  uploadFile: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock('@/lib/workspace-api-context', () => ({ useWorkspaceApi: () => mock }));
vi.mock('@/components/chat/markdown-content', () => ({
  MarkdownContent: ({ content }: { content: string }) => React.createElement('div', { 'data-testid': 'markdown' }, content),
}));
vi.mock('@/components/files/authenticated-file-image', () => ({
  AuthenticatedFileImage: ({ alt }: { alt: string }) => React.createElement('span', null, alt),
}));
vi.mock('@/components/ui/markdown-toolbar', () => ({
  MarkdownToolbar: ({ label }: { label: string }) => React.createElement('div', { role: 'toolbar', 'aria-label': label }),
}));
vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  TabsList: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => React.createElement('div', props, children),
  TabsTrigger: ({ children, value }: { children: React.ReactNode; value: string }) => React.createElement('button', { type: 'button', 'data-value': value }, children),
}));
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? React.createElement('div', null, children) : null,
  SheetContent: ({ children, onOpenAutoFocus: _focus, ...props }: React.HTMLAttributes<HTMLDivElement> & { onOpenAutoFocus?: unknown }) => React.createElement('div', { role: 'dialog', ...props }, children),
  SheetHeader: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => React.createElement('header', props, children),
  SheetTitle: ({ children, asChild: _asChild }: { children: React.ReactNode; asChild?: boolean }) => React.createElement(React.Fragment, null, children),
  SheetDescription: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => React.createElement('p', props, children),
}));
vi.mock('@/components/ui/responsive-dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? React.createElement('div', { 'data-testid': 'confirm-dialog' }, children) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) => React.createElement('header', null, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) => React.createElement('h2', null, children),
  DialogDescription: ({ children }: { children: React.ReactNode }) => React.createElement('p', null, children),
  DialogFooter: ({ children }: { children: React.ReactNode }) => React.createElement('footer', null, children),
}));

const plan: ProjectPlanItem = {
  id: 'plan-1', title: '发布计划', description: 'Current plan', status: 'doing', assignees: [],
  priority: 'high', tags: ['release'], startDate: '2026-09-18', dueDate: '2026-09-22',
  attachments: [{ id: 'brief', filename: 'brief.txt', contentType: 'text/plain', size: 12 }],
  acceptanceCriteria: 'All checks pass', version: 3, tasks: [],
};
const task = (updates: Partial<KanbanTask> = {}): KanbanTask => ({
  id: 'task-1', title: '检查发布', description: '**验证** 部署', status: 'in_progress', priority: 'high',
  assignee: 'builder', workflowId: null, knowledgeIds: [], fileIds: ['brief'],
  attachments: [{ id: 'brief', filename: 'brief.txt', contentType: 'text/plain', size: 12 }],
  createdBy: 'owner', channelName: 'task:task-1', position: 0, run: null, lastMessage: null,
  createdAt: '2026-09-20T08:00:00Z', updatedAt: '2026-09-20T09:00:00Z', planItemId: 'plan-1',
  responsibleUserId: 'member-1', sourceVersion: 2, executionStatus: 'running', acceptanceCriteria: '- smoke test',
  tags: ['release'], startDate: '2026-09-18', dueDate: '2026-09-22', ...updates,
});
const event = (updates: Partial<TaskTimelineItem> = {}): TaskTimelineItem => ({
  id: 'event-1', categories: ['activity'], kind: 'workspace.task.activity',
  actor: { type: 'system', id: null, name: 'System' }, content: 'Task dispatched', attachments: [],
  changes: [], from: null, to: null, createdAt: '2026-09-20T08:00:00Z', ...updates,
});
const review: TaskReview = {
  taskId: 'task-1', planItemId: 'plan-1', planTitle: '发布计划', title: '检查发布', description: '',
  acceptanceCriteria: 'All checks pass', responsibleUserId: 'member-1', responsibleName: '成员一',
  status: 'need_input', reviewState: 'pending', channelName: 'task:task-1', submissionVersion: 4,
  submission: { summary: 'done', fileIds: [], userId: 'member-1', submittedAt: '2026-09-20T08:00:00Z', reviewDecision: null, reviewComment: null, reviewedByUserId: null, reviewerName: null, reviewedAt: null },
  files: [], submissionHistory: [], activityHistory: [],
};

let host: HTMLDivElement;
let root: Root;
const onOpenChange = vi.fn();
const onChanged = vi.fn();

function view(initialView: TaskTimelineView = 'all', canManage = true, open = true) {
  return React.createElement(I18nProvider, { initialLocale: 'zh-CN', hasStoredLocale: true,
    children: React.createElement(TaskDetailSheet, { taskId: 'task-1', planItem: plan, open, canManage, initialView, onOpenChange, onChanged }),
  });
}
async function render(initialView: TaskTimelineView = 'all', canManage = true) {
  await act(async () => { root.render(view(initialView, canManage)); });
}
async function clickButton(text: string) {
  const button = Array.from(host.querySelectorAll('button')).filter((entry) => entry.textContent?.trim() === text).at(-1);
  expect(button, text).toBeDefined();
  await act(async () => { button!.click(); });
}
async function enter(value: string) {
  const textarea = host.querySelector<HTMLTextAreaElement>(`textarea[id^="task-comment-"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return textarea;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  mock.getTask.mockReset().mockResolvedValue(task());
  mock.getTeam.mockReset().mockResolvedValue([{ id: 'member-1', userId: 'member-1', email: 'one@example.test', displayName: '成员一', avatarUrl: null, role: 'member', joinedAt: null }]);
  mock.getTaskReview.mockReset().mockResolvedValue(review);
  mock.getTaskTimeline.mockReset().mockResolvedValue({ items: [event()], nextCursor: null });
  mock.addTaskComment.mockReset();
  mock.decideTaskReview.mockReset().mockResolvedValue(review);
  mock.uploadFile.mockReset(); mock.downloadFile.mockReset();
  onOpenChange.mockReset(); onChanged.mockReset();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('TaskDetailSheet', () => {
  it('loads a task, keeps its snapshot read-only and shows the plan version gap', async () => {
    await render();
    expect(host.textContent).toContain('检查发布');
    expect(host.textContent).toContain('成员一');
    expect(host.textContent).toContain('任务快照 v2');
    expect(host.textContent).toContain('当前计划 v3');
    expect(host.textContent).toContain('该任务使用的是较早版本计划');
    expect(host.textContent).toContain('Task dispatched');
    expect(mock.getTaskTimeline).toHaveBeenCalledWith('task-1', expect.objectContaining({ category: 'all', sort: 'desc' }));
  });

  it('renders all five timeline views and reloads the selected category', async () => {
    await render();
    expect(Array.from(host.querySelectorAll('[data-value]')).map((entry) => entry.getAttribute('data-value'))).toEqual([
      'all', 'activity', 'comments', 'transition', 'history',
    ]);
    mock.getTaskTimeline.mockClear();
    await act(async () => { root.render(view('history')); });
    expect(mock.getTaskTimeline).toHaveBeenCalledWith('task-1', expect.objectContaining({ category: 'history' }));
  });

  it('rejects a task that is not owned by the selected plan item', async () => {
    mock.getTask.mockResolvedValue(task({ planItemId: 'another-plan' }));
    await render();
    expect(host.textContent).toContain('该任务不属于当前计划项');
    expect(mock.getTaskTimeline).not.toHaveBeenCalled();
  });

  it('keeps the comment draft after a failed post and clears it after retry', async () => {
    mock.addTaskComment.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(event({ id: 'comment-1', categories: ['comments'], kind: 'comment', actor: { type: 'human', id: 'owner', name: 'Owner' }, content: '请复查' }));
    await render('comments', false);
    const textarea = await enter('请复查');
    await clickButton('评论');
    expect(textarea.value).toBe('请复查');
    expect(host.textContent).toContain('offline');
    await clickButton('评论');
    expect(textarea.value).toBe('');
    expect(host.textContent).toContain('请复查');
    expect(mock.addTaskComment).toHaveBeenCalledTimes(2);
  });

  it('uses the existing submission-version review endpoint for approval', async () => {
    mock.getTask.mockResolvedValue(task({ status: 'need_input', submittedSummary: 'ready' }));
    await render('all', true);
    await clickButton('通过');
    expect(host.textContent).toContain('通过任务审核');
    await clickButton('确认');
    expect(mock.decideTaskReview).toHaveBeenCalledWith('task-1', 4, 'approved', '');
  });

  it('polls while open and clears the timer when the sheet closes', async () => {
    vi.useFakeTimers();
    try {
      await render();
      const initialTaskCalls = mock.getTask.mock.calls.length;
      await act(async () => { vi.advanceTimersByTime(5_000); await Promise.resolve(); });
      expect(mock.getTask.mock.calls.length).toBeGreaterThan(initialTaskCalls);
      await act(async () => { root.render(view('all', true, false)); });
      const closedTaskCalls = mock.getTask.mock.calls.length;
      await act(async () => { vi.advanceTimersByTime(10_000); await Promise.resolve(); });
      expect(mock.getTask).toHaveBeenCalledTimes(closedTaskCalls);
    } finally {
      vi.useRealTimers();
    }
  });
});
