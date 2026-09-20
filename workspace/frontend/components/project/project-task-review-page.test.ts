// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  list: vi.fn(), get: vi.fn(), decide: vi.fn(), getTask: vi.fn(), download: vi.fn(), refresh: vi.fn(),
}));
vi.mock('@/lib/workspace-api-context', () => {
  const api = { listTaskReviews: mock.list, getTaskReview: mock.get, decideTaskReview: mock.decide,
    getTask: mock.getTask, downloadFile: mock.download };
  return { useWorkspaceApi: () => api };
});
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ refreshTasks: mock.refresh }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ locale: 'zh-CN' }) }));
vi.mock('@/components/tasks/task-chat-popup', () => ({ TaskChatPopup: () => React.createElement('div', { 'data-testid': 'task-chat' }) }));

import { ProjectTaskReviewPage } from './project-task-review-page';

const submission = { summary: '已完成回归测试', fileIds: ['file-1'], userId: 'member-1', submittedAt: '2026-09-20T10:00:00Z', reviewDecision: null, reviewComment: null, reviewedByUserId: null, reviewerName: null, reviewedAt: null };
const pending = { taskId: 'task-1', planItemId: 'plan-1', planTitle: '版本发布', title: '回归测试', description: '测试主要流程', acceptanceCriteria: '覆盖登录与工作台', responsibleUserId: 'member-1', responsibleName: '小林', status: 'need_input', reviewState: 'pending', channelName: 'task:task-1', submissionVersion: 1, submission, submissionHistory: [submission], activityHistory: [], files: [{ id: 'file-1', filename: '测试报告.pdf', size: 2048, contentType: 'application/pdf' }] };
const processed = { ...pending, reviewState: 'processed', status: 'done', submission: { ...submission, reviewDecision: 'approved', reviewedByUserId: 'admin', reviewerName: '管理员', reviewedAt: '2026-09-20T11:00:00Z' } };

let root: Root;
let element: HTMLDivElement;
async function render(initialTaskId?: string) {
  await act(async () => root.render(React.createElement(ProjectTaskReviewPage, { initialTaskId })));
}
async function click(text: string) {
  const target = [...element.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes(text));
  expect(target).toBeDefined();
  await act(async () => target!.click());
}

describe('project task review page', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.clearAllMocks();
    mock.list.mockImplementation(async (state: string) => state === 'pending' ? [pending] : [processed]);
    mock.get.mockResolvedValue(pending);
    mock.decide.mockResolvedValue(processed);
    mock.getTask.mockResolvedValue({ id: 'task-1', channelName: 'task:task-1', title: '回归测试', assignee: null });
    mock.refresh.mockResolvedValue(undefined);
    element = document.createElement('div'); document.body.appendChild(element); root = createRoot(element);
  });
  afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.unstubAllGlobals(); });

  it('shows a dense list, details, attachment, history and task conversation', async () => {
    await render();
    expect(element.textContent).toContain('版本发布');
    expect(element.textContent).toContain('覆盖登录与工作台');
    expect(element.textContent).toContain('测试报告.pdf');
    await click('任务对话');
    expect(element.querySelector('[data-testid="task-chat"]')).not.toBeNull();
    await click('已处理');
    expect(mock.list).toHaveBeenCalledWith('processed');
    expect(element.textContent).toContain('已通过');
  });

  it('requires a return reason and sends the latest submission version', async () => {
    await render();
    await click('退回修改');
    const textarea = document.querySelector('textarea')!;
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '确认')!;
    expect(confirm.disabled).toBe(true);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, '请补充截图');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => confirm.click());
    expect(mock.decide).toHaveBeenCalledWith('task-1', 1, 'returned', '请补充截图');
    expect(mock.refresh).toHaveBeenCalled();
  });

  it('opens a deep-linked review and lets mobile return to the list', async () => {
    await render('task-1');
    expect(mock.get).toHaveBeenCalledWith('task-1');
    expect(element.textContent).toContain('返回列表');
    await click('返回列表');
    const list = element.querySelector('[aria-current="true"]');
    expect(list).not.toBeNull();
  });
});
