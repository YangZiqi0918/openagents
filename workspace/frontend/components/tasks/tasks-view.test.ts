// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { TasksView } from './tasks-view';

const mock = vi.hoisted(() => ({
  task: {
    id: 'task-1', title: '验证部署', description: '检查线上服务', status: 'backlog',
    responsibleUserId: 'member-1', planItemId: 'plan-1', executionStatus: 'idle',
    assignee: null, workflowId: null, channelName: 'task:task-1', knowledgeIds: [], fileIds: [],
    position: 0, createdBy: 'admin', run: null, lastMessage: null, createdAt: null, updatedAt: null,
  } as Record<string, unknown>,
  acceptTask: vi.fn(), runTask: vi.fn(), submitTask: vi.fn(), refreshTasks: vi.fn(),
}));

vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({
  tasks: [mock.task], refreshTasks: mock.refreshTasks, createTask: vi.fn(), updateTask: vi.fn(),
  runTask: mock.runTask, stopTask: vi.fn(), deleteTask: vi.fn(), canWrite: true,
  workspace: { kind: 'project' }, me: { role: 'member', userId: 'member-1' }, agents: [], workflows: [],
}) }));
vi.mock('@/lib/workspace-api-context', () => ({ useWorkspaceApi: () => ({
  acceptTask: mock.acceptTask, submitTask: mock.submitTask,
}) }));
vi.mock('@/components/layout/layout-context', () => ({ useLayout: () => ({ pendingTaskChannel: null, setPendingTaskChannel: vi.fn() }) }));
vi.mock('@/components/layout/app-header', () => ({ DetailHeader: ({ title, children }: { title: React.ReactNode; children: React.ReactNode }) => React.createElement('div', null, title, children) }));
vi.mock('@/components/tours/feature-tours', () => ({ FeatureTourBanner: () => null }));
vi.mock('./new-task-dialog', () => ({ NewTaskDialog: () => null, AttachmentPicker: () => null }));
vi.mock('./task-chat-popup', () => ({ TaskChatPopup: () => null }));
vi.mock('./task-execution-dialog', () => ({ TaskExecutionDialog: () => null }));

let root: Root;
let container: HTMLDivElement;
const render = async () => act(() => root.render(React.createElement(I18nProvider, { initialLocale: 'zh-CN', hasStoredLocale: true, children: React.createElement(TasksView) })));
const button = (name: string) => {
  const element = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent?.trim() === name);
  expect(element, name).toBeDefined();
  return element!;
};

describe('personal task pool', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mock.task = { ...mock.task, status: 'backlog', assignee: null, executionStatus: 'idle' };
    mock.acceptTask.mockReset().mockResolvedValue(mock.task);
    mock.runTask.mockReset().mockResolvedValue(undefined);
    mock.submitTask.mockReset().mockResolvedValue(mock.task);
    mock.refreshTasks.mockReset().mockResolvedValue(undefined);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('accepts from backlog without launching an agent, then enables running only in progress', async () => {
    await render();
    expect(container.textContent).toContain('接收任务');
    expect(container.textContent).not.toContain('新建任务');
    expect(container.textContent).not.toContain('运行');
    await act(async () => button('接收任务').click());
    expect(mock.acceptTask).toHaveBeenCalledWith('task-1');
    expect(mock.runTask).not.toHaveBeenCalled();

    mock.task = { ...mock.task, status: 'in_progress', assignee: 'codex' };
    await render();
    expect(container.textContent).toContain('提交审核');
    await act(async () => button('运行').click());
    expect(mock.runTask).toHaveBeenCalledWith('task-1');
  });

  it('keeps submitted tasks in the review column without a run action', async () => {
    mock.task = { ...mock.task, status: 'need_input', assignee: 'codex', submittedSummary: '已验证' };
    await render();
    expect(container.textContent).toContain('需要关注 · 待审核');
    expect(container.textContent).toContain('已验证');
    expect(container.textContent).not.toContain('提交审核');
    expect(container.textContent).not.toContain('运行');
  });
});
