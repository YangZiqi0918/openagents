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
  getTeam: vi.fn(),
}));

vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({
  tasks: [mock.task], refreshTasks: mock.refreshTasks, createTask: vi.fn(), updateTask: vi.fn(),
  runTask: mock.runTask, stopTask: vi.fn(), deleteTask: vi.fn(), canWrite: true,
  workspace: { kind: 'project' }, me: { role: 'member', userId: 'member-1' }, agents: [], workflows: [],
}) }));
vi.mock('@/lib/workspace-api-context', () => {
  const api = { acceptTask: mock.acceptTask, submitTask: mock.submitTask, getTeam: mock.getTeam };
  return { useWorkspaceApi: () => api };
});
vi.mock('@/components/layout/layout-context', () => ({ useLayout: () => ({ pendingTaskChannel: null, setPendingTaskChannel: vi.fn() }) }));
vi.mock('@/components/layout/app-header', () => ({ DetailHeader: ({ title, children }: { title: React.ReactNode; children: React.ReactNode }) => React.createElement('div', null, title, children) }));
vi.mock('@/components/tours/feature-tours', () => ({ FeatureTourBanner: () => null }));
vi.mock('./new-task-dialog', () => ({ NewTaskDialog: () => null, AttachmentPicker: () => null }));
vi.mock('./task-chat-popup', () => ({ TaskChatPopup: () => null }));
vi.mock('./task-execution-dialog', () => ({ TaskExecutionDialog: () => null }));

let root: Root;
let container: HTMLDivElement;
const render = async () => act(async () => root.render(React.createElement(I18nProvider, { initialLocale: 'zh-CN', hasStoredLocale: true, children: React.createElement(TasksView) })));
const overview = () => {
  const element = container.querySelector('[aria-label="任务概览"]');
  expect(element).not.toBeNull();
  return element!;
};
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
    mock.getTeam.mockReset().mockResolvedValue([{
      userId: 'member-1', username: '周若曦', displayName: '周若曦', email: 'member@example.com',
      avatarUrl: null, role: 'member', joinedAt: null,
    }]);
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
    expect(container.textContent).not.toContain('提交结果');
    expect(container.textContent).not.toContain('已验证');
    expect(container.textContent).not.toContain('提交审核');
    expect(container.textContent).not.toContain('运行');
    const reviewCard = overview().parentElement;
    expect(reviewCard?.className).toContain('min-h-[180px]');

    mock.task = { ...mock.task, status: 'in_progress' };
    await render();
    expect(overview().parentElement?.className).toContain('min-h-[180px]');
  });

  it('shows scannable task metadata, two tags plus overflow, and overdue dates', async () => {
    mock.task = {
      ...mock.task,
      title: '一个需要在窄列换行的完整业务任务标题',
      description: '第一行描述。第二行描述。第三行应只在详情中完整查看。',
      priority: 'urgent', startDate: '2020-09-01', dueDate: '2020-09-03',
      tags: ['产品', '验收', '第三个标签', '第四个标签'], fileIds: ['file-1', 'file-2'],
      acceptanceCriteria: '验收标准应在任务详情完整查看。',
    };
    mock.getTeam.mockResolvedValueOnce([{
      userId: 'member-1', username: '很长的项目成员姓名需要截断', displayName: null,
      email: 'member@example.com', avatarUrl: null, role: 'member', joinedAt: null,
    }]);

    await render();

    expect(mock.getTeam).toHaveBeenCalledOnce();
    const metadata = overview();
    expect(metadata.textContent).toContain('待接收');
    expect(metadata.textContent).toContain('紧急');
    expect(metadata.textContent).toContain('2020');
    expect(metadata.textContent).toContain('很长的项目成员姓名需要截断');
    expect(metadata.textContent).toContain('产品');
    expect(metadata.textContent).toContain('验收');
    expect(metadata.textContent).not.toContain('第三个标签');
    expect(metadata.textContent).toContain('+2');
    expect(metadata.querySelector('[title="第三个标签, 第四个标签"]')).not.toBeNull();
    expect(metadata.querySelector('[title="已附加 2 个文件"]')?.textContent).toContain('2');
    expect(metadata.querySelector('[title*="2020"]')?.className).toContain('text-rose-700');
    expect(container.querySelector('p[title="一个需要在窄列换行的完整业务任务标题"]')?.className).toContain('line-clamp-2');
    expect(container.querySelector('p[title="验收标准应在任务详情完整查看。"]')?.className).toContain('line-clamp-2');
  });

  it.each([
    [{ dueDate: '2999-12-31', startDate: null }, '截止'],
    [{ startDate: '2999-01-01', dueDate: null }, '开始'],
  ])('shows only an available date for %j', async (dates, expectedLabel) => {
    mock.task = { ...mock.task, ...dates, priority: null, tags: [], fileIds: [] };
    await render();
    const metadata = overview();
    expect(metadata.textContent).toContain(expectedLabel);
    expect(metadata.querySelector('[title*="2999"]')?.className).not.toContain('text-rose-700');
    expect(metadata.children).toHaveLength(3); // status, date, owner
  });

  it('omits badges for absent optional fields without leaving placeholders', async () => {
    mock.task = { ...mock.task, priority: null, startDate: null, dueDate: null, tags: [], fileIds: [] };
    await render();
    const metadata = overview();
    expect(metadata.children).toHaveLength(2); // status and owner
    expect(metadata.textContent).toContain('周若曦');
    expect(metadata.textContent).not.toContain('undefined');
  });

  it('keeps human review distinct from AI waiting for input and legacy task input', async () => {
    mock.task = { ...mock.task, status: 'need_input', executionStatus: 'need_input', submittedSummary: '已验证' };
    await render();
    expect(overview().textContent).toContain('待审核');
    expect(overview().textContent).not.toContain('需要输入');
    expect(container.textContent).toContain('智能体等待输入');
    expect(container.textContent).not.toContain('运行');

    mock.task = { ...mock.task, responsibleUserId: null, planItemId: null, status: 'need_input', lastMessage: '请补充日志' };
    await render();
    expect(overview().textContent).toContain('需要输入');
    expect(overview().textContent).not.toContain('待审核');
    expect(container.textContent).toContain('请补充日志');
    expect(container.textContent).not.toContain('智能体等待输入');
    expect(container.querySelector('[role="region"][aria-label="需要关注"]')).not.toBeNull();
  });

  it('keeps desktop status headers fixed and card lists keyboard-scrollable without mobile nested scrolling', async () => {
    await render();
    const regions = Array.from(container.querySelectorAll('[role="region"]'));
    expect(regions).toHaveLength(4);
    expect(regions[0].getAttribute('tabindex')).toBe('0');
    expect(regions[0].className).toContain('xl:overflow-y-auto');
    expect(regions[0].className).toContain('xl:[scrollbar-gutter:stable]');
    expect(regions[0].className).toContain('focus-visible:outline-2');
    expect(regions[0].parentElement?.className).toContain('xl:h-full');
    expect(regions[0].previousElementSibling?.className).toContain('shrink-0');
    for (const region of regions.slice(1)) {
      expect(region.getAttribute('tabindex')).toBe('-1');
      expect(region.className).not.toContain('xl:[scrollbar-gutter:stable]');
    }
    const board = regions[0].parentElement?.parentElement?.parentElement;
    expect(board?.className).toContain('overflow-y-auto');
    expect(board?.className).toContain('xl:overflow-hidden');
    expect(regions[0].className).not.toMatch(/(^|\s)overflow-y-auto(\s|$)/);
  });
});
