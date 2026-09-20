// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { KanbanTask, ONMEvent, WorkspaceAgent, WorkspaceMessage } from '@/lib/types';
import { TaskChatPopup } from './task-chat-popup';

const mock = vi.hoisted(() => ({
  task: null as KanbanTask | null,
  agents: [] as WorkspaceAgent[],
  messages: [] as WorkspaceMessage[],
  meId: 'owner',
  getTask: vi.fn(), fetchResource: vi.fn(), pollEvents: vi.fn(), sendMessage: vi.fn(), uploadFile: vi.fn(), getFileUrl: vi.fn(),
  forceRefresh: vi.fn(), pollingOptions: null as Record<string, unknown> | null,
  displayed: [] as WorkspaceMessage[], input: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/api-config', () => ({ IS_LOCAL_AUTH: true }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({
  agents: mock.agents, currentUser: { id: mock.meId, name: mock.meId }, canWrite: true,
  workspace: { workspaceId: 'project-a', kind: 'project' }, me: { userId: mock.meId },
}) }));
vi.mock('@/lib/workspace-api-context', () => ({ useWorkspaceApi: () => mock }));
vi.mock('@/hooks/use-polling', () => ({ useMessagePolling: (options: Record<string, unknown>) => {
  mock.pollingOptions = options;
  return { messages: mock.messages, forceRefresh: mock.forceRefresh, generation: 0,
    loadOlder: vi.fn(), hasOlder: false, loadingOlder: false, error: null };
} }));
vi.mock('@/components/ui/responsive-dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  DialogContent: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));
vi.mock('@/components/chat/chat-messages', () => ({ ChatMessages: (props: { messages: WorkspaceMessage[] }) => {
  mock.displayed = props.messages;
  return React.createElement('div', { 'data-testid': 'task-messages' }, props.messages.map((m) => m.content).join(' '));
} }));
vi.mock('@/components/agents/agent-avatar', () => ({ AgentAvatar: ({ name }: { name: string }) => React.createElement('span', null, name) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const agent = (status = 'online'): WorkspaceAgent => ({
  agentName: 'helper', displayName: null, role: 'member', agentType: 'cloud:openagents', status,
  serverHost: null, workingDir: null, description: null, enabledSkills: null, model: null,
  lastHeartbeatAt: null, joinedAt: null,
});
const task = (): KanbanTask => ({
  id: 'one', title: 'Task one', description: '', status: 'in_progress', assignee: 'helper',
  workflowId: null, knowledgeIds: [], fileIds: [], createdBy: 'owner', channelName: 'task:one',
  position: 0, run: null, lastMessage: null, createdAt: null, updatedAt: null,
  responsibleUserId: 'owner', executionStatus: 'running', activeRunId: 'run-1',
});
const message = (id: string, seconds: number, overrides: Partial<WorkspaceMessage> = {}): WorkspaceMessage => ({
  messageId: id, sessionId: 'task:one', senderType: 'human', senderName: 'owner',
  content: id, mentions: [], targetAgents: null, messageType: 'chat', metadata: { task_run_id: 'run-1' },
  createdAt: new Date(Date.parse('2026-09-20T12:00:00.000Z') + seconds * 1000).toISOString(), ...overrides,
});

let host: HTMLDivElement;
let root: Root;
const popup = (sessionId = 'task:one', taskId = 'one') => React.createElement(I18nProvider, {
  initialLocale: 'zh-CN', hasStoredLocale: true,
  children: React.createElement(TaskChatPopup, {
    open: true, onOpenChange: vi.fn(), sessionId, taskId, taskTitle: taskId, assignee: 'helper',
  }),
});
async function render() { await act(async () => root.render(popup())); }
async function enter(value: string) {
  const textarea = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(selector: string) {
  const element = host.querySelector(selector);
  expect(element, selector).not.toBeNull();
  await act(async () => (element as HTMLElement).click());
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  mock.task = task();
  mock.agents = [agent()];
  mock.messages = [];
  mock.meId = 'owner';
  mock.displayed = [];
  mock.pollingOptions = null;
  mock.getTask.mockReset().mockImplementation(async () => mock.task);
  mock.fetchResource.mockReset().mockResolvedValue({ json: async () => ({ data: {
    participants: ['helper'], workflowRunning: false, activeWorkflowStepAgent: null,
  } }) });
  mock.pollEvents.mockReset().mockResolvedValue({ events: [], has_more: false });
  mock.forceRefresh.mockReset();
  mock.sendMessage.mockReset().mockImplementation(async (_channel: string, content: string): Promise<ONMEvent> => ({
    id: 'confirmed', type: 'workspace.message.posted', source: 'human:owner', target: 'channel/task:one',
    payload: { content, sender_name: 'owner' }, metadata: { task_run_id: 'run-1', target_agents: ['helper'] },
    timestamp: Date.parse('2026-09-20T12:00:00.000Z'), visibility: 'channel',
  }));
  mock.uploadFile.mockReset().mockResolvedValue({ id: 'file-1', filename: 'note.txt', contentType: 'text/plain' });
  mock.getFileUrl.mockReset().mockReturnValue('/files/file-1');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('project task conversation', () => {
  it('offers only the current joined online task agent through real ChatInput', async () => {
    await render();
    expect(mock.pollingOptions).toMatchObject({ sessionId: 'task:one', includeThinkingHistory: true });
    await enter('@');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(host.textContent).not.toContain('加入会话后参与');
    await click('[role="option"]');
    expect(host.querySelector('textarea')!.value).toBe('@helper');
    await click('[aria-label="发送消息"]');
    expect(mock.sendMessage).toHaveBeenCalledWith('task:one', '@helper', 'owner', ['helper'], undefined, 'owner');
    expect(mock.displayed.map((m) => m.messageId)).toContain('confirmed');
  });

  it('keeps the task agent available for previously persisted in_progress execution values', async () => {
    mock.task = { ...task(), executionStatus: 'in_progress' };
    await render();
    await enter('@');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
  });

  it('offers the assignee when owner input is needed and resumes waiting immediately after the reply', async () => {
    mock.task = { ...task(), executionStatus: 'need_input' };
    mock.messages = [message('old-request', -2, { targetAgents: ['helper'] })];
    mock.getTask.mockImplementationOnce(async () => mock.task);
    mock.getTask.mockImplementationOnce(async () => ({ ...mock.task!, executionStatus: 'running' }));
    await render();
    expect(mock.displayed.some((entry) => entry.messageType === 'loading')).toBe(false);
    await enter('@');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
    await click('[role="option"]');
    await click('[aria-label="发送消息"]');
    expect(mock.getTask).toHaveBeenCalledTimes(2);
    expect(mock.displayed.find((entry) => entry.messageType === 'loading')?.messageId).toBe('task-loading-confirmed');
  });

  it('does not offer an agent while the workflow is waiting for a human step', async () => {
    mock.task = { ...task(), executionStatus: 'need_input', workflowId: 'flow', run: {
      status: 'running', stepIndex: 1, stepCount: 2, stepName: 'Approve',
      stepAssignee: 'owner', stepAssigneeKind: 'human', iterations: 0, maxIterations: 3,
    } };
    mock.fetchResource.mockResolvedValue({ json: async () => ({ data: {
      participants: ['helper'], workflowRunning: true, activeWorkflowStepAgent: null,
    } }) });
    mock.messages = [message('old-request', 0, { targetAgents: ['helper'] })];
    await render();
    await enter('@');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(mock.displayed.some((entry) => entry.messageType === 'loading')).toBe(false);
  });

  it('does not route a need-input task during pending ownership transfer', async () => {
    mock.task = { ...task(), executionStatus: 'need_input', transferUserId: 'next-owner' };
    mock.messages = [message('old-request', 0, { targetAgents: ['helper'] })];
    await render();
    await enter('@');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(mock.displayed.some((entry) => entry.messageType === 'loading')).toBe(false);
  });

  it('keeps local legacy tasks on their previous input and history path', async () => {
    mock.task = { ...task(), responsibleUserId: null, activeRunId: null };
    await render();
    expect(mock.pollingOptions).toMatchObject({ includeThinkingHistory: false });
    await enter('@');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(host.querySelector('textarea')?.getAttribute('placeholder')).not.toContain('项目成员');
  });

  it('has no agent candidate for other project members, paused or offline agents', async () => {
    mock.meId = 'another-member';
    await render();
    await enter('@');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(0);
    mock.meId = 'owner';
    mock.task = { ...task(), executionStatus: 'paused' };
    await render();
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(0);
    mock.task = task();
    mock.agents = [agent('offline')];
    await render();
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(0);
  });

  it('shows a current-run wait to any project member, keeps real thinking after reply, and ignores placeholders', async () => {
    mock.meId = 'another-member';
    mock.messages = [message('old', -10, { metadata: { task_run_id: 'previous' }, targetAgents: ['helper'] }),
      message('ask', 0, { targetAgents: ['helper'] }),
      message('placeholder', 1, { senderType: 'agent', senderName: 'helper', content: 'thinking...', messageType: 'thinking' }),
      message('thought', 2, { senderType: 'agent', senderName: 'helper', content: 'A real insight', messageType: 'thinking' })];
    await render();
    expect(mock.displayed.some((m) => m.messageType === 'loading')).toBe(true);
    expect(mock.displayed.some((m) => m.content === 'thinking...')).toBe(false);
    expect(mock.displayed.some((m) => m.content === 'A real insight')).toBe(true);
    mock.messages = [...mock.messages, message('reply', 3, { senderType: 'agent', senderName: 'helper' })];
    await render();
    expect(mock.displayed.some((m) => m.messageType === 'loading')).toBe(false);
    expect(mock.displayed.some((m) => m.content === 'A real insight')).toBe(true);
  });

  it('recognizes daemon thinking and replies without run metadata after a current-run request', async () => {
    mock.messages = [message('ask', 0, { targetAgents: ['helper'] }),
      message('thinking', 100, { senderType: 'agent', senderName: 'helper', content: 'Investigating',
        messageType: 'thinking', metadata: {} })];
    await render();
    expect(mock.displayed.some((m) => m.messageType === 'loading')).toBe(true);
    expect(mock.displayed.some((m) => m.content === 'Investigating')).toBe(true);
    mock.messages = [...mock.messages, message('finished', 110, { senderType: 'agent', senderName: 'helper', metadata: {} })];
    await render();
    expect(mock.displayed.some((m) => m.messageType === 'loading')).toBe(false);
  });

  it('degrades a wait to static after 120 seconds and resets on genuine thinking', async () => {
    const old = new Date(Date.now() - 125_000).toISOString();
    mock.messages = [message('ask', 0, { targetAgents: ['helper'], createdAt: old })];
    await render();
    expect(mock.displayed.find((m) => m.messageType === 'loading')?.metadata.waitingPhase).toBe('stale');
    mock.messages = [...mock.messages, message('thought', 20, {
      senderType: 'agent', senderName: 'helper', messageType: 'thinking', content: 'Current progress',
      metadata: {}, createdAt: new Date(Date.now() - 1_000).toISOString(),
    })];
    await render();
    expect(mock.displayed.find((m) => m.messageType === 'loading')?.metadata.waitingPhase).toBe('active');
  });

  it('only offers the running workflow agent step already in the task channel', async () => {
    mock.task = { ...task(), workflowId: 'flow', assignee: null,
      run: { status: 'running', stepIndex: 1, stepCount: 2, stepName: 'Review',
        stepAssignee: 'helper', stepAssigneeKind: 'agent', iterations: 0, maxIterations: 3 } };
    mock.fetchResource.mockResolvedValue({ json: async () => ({ data: {
      participants: ['helper'], workflowRunning: true, activeWorkflowStepAgent: 'other',
    } }) });
    await render();
    await enter('@');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(0);
    mock.fetchResource.mockResolvedValue({ json: async () => ({ data: {
      participants: ['helper'], workflowRunning: true, activeWorkflowStepAgent: 'helper',
    } }) });
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
  });

  it('shows waiting for a tagged workflow agent step, not a human step or a previous run', async () => {
    mock.task = { ...task(), workflowId: 'flow', assignee: 'helper', run: {
      status: 'running', stepIndex: 0, stepCount: 2, stepName: 'Draft',
      stepAssignee: 'helper', stepAssigneeKind: 'agent', iterations: 0, maxIterations: 3,
    } };
    mock.fetchResource.mockResolvedValue({ json: async () => ({ data: {
      participants: ['helper'], workflowRunning: true, activeWorkflowStepAgent: 'helper',
    } }) });
    mock.messages = [message('workflow-instruction', 0, { senderType: 'agent', senderName: 'system:workflow',
      targetAgents: ['helper'], metadata: { task_run_id: 'run-1', workflow_step: 'first' } })];
    await render();
    expect(mock.displayed.some((m) => m.messageType === 'loading')).toBe(true);

    mock.task = { ...mock.task, executionStatus: 'need_input', assignee: null,
      run: { ...mock.task.run!, stepIndex: 1, stepName: 'Approval', stepAssignee: 'owner', stepAssigneeKind: 'human' } };
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(mock.displayed.some((m) => m.messageType === 'loading')).toBe(false);

    mock.task = { ...task(), activeRunId: 'run-2' };
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(mock.displayed.some((m) => m.messageType === 'loading')).toBe(false);
    mock.messages = [...mock.messages, message('fresh', 10, {
      targetAgents: ['helper'], metadata: { task_run_id: 'run-2' },
    })];
    await render();
    expect(mock.displayed.find((m) => m.messageType === 'loading')?.messageId).toBe('task-loading-fresh');
  });

  it('hides waiting when a run stops or the target goes offline', async () => {
    mock.messages = [message('ask', 0, { targetAgents: ['helper'] })];
    await render();
    expect(mock.displayed.some((m) => m.messageType === 'loading')).toBe(true);
    mock.task = { ...task(), activeRunId: null, executionStatus: 'paused' };
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(mock.displayed.some((m) => m.messageType === 'loading')).toBe(false);
    mock.task = task();
    mock.agents = [agent('offline')];
    await render();
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(mock.displayed.some((m) => m.messageType === 'loading')).toBe(false);
  });

  it('retains the failed draft and uploaded attachment for an idempotent retry', async () => {
    await render();
    await enter('Please review');
    const picker = host.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['notes'], 'note.txt', { type: 'text/plain' });
    Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
    await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })));
    mock.sendMessage.mockRejectedValueOnce(new Error('Retryable failure'));
    await click('[aria-label="发送消息"]');
    expect(host.querySelector('textarea')?.value).toBe('Please review');
    expect(host.textContent).toContain('note.txt');
    await click('[aria-label="重试发送"]');
    expect(mock.sendMessage).toHaveBeenCalledTimes(2);
    expect(mock.uploadFile).toHaveBeenCalledTimes(1);
    expect(host.querySelector('textarea')?.value).toBe('');
  });
});
