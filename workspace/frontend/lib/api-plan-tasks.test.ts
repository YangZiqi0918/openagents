import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceApi } from './api';

const task = {
  id: 'task-1', title: '检查部署', description: '部署验收', status: 'backlog',
  priority: 'urgent',
  plan_item_id: 'plan-1', responsible_user_id: 'member-1', channel_name: 'task:task-1',
  execution_status: 'idle', submission_history: [],
};

afterEach(() => vi.unstubAllGlobals());

describe('plan dispatch and member task actions', () => {
  it('keeps dispatch, acceptance and AI run as distinct server actions', async () => {
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      return { ok: true, json: async () => ({ data: url.endsWith('/dispatch') ? { tasks: [task] } : task }) };
    }));
    workspaceApi.configure('project-1', 'test-token');

    const dispatched = await workspaceApi.dispatchPlanItem('plan-1', ['member-1'], 3);
    const accepted = await workspaceApi.acceptTask(dispatched.tasks[0].id);

    expect(dispatched.tasks[0]).toMatchObject({ responsibleUserId: 'member-1', planItemId: 'plan-1', channelName: 'task:task-1', priority: 'urgent' });
    expect(accepted.status).toBe('backlog'); // The mock does not advance state; the client never infers it.
    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      '/v1/workspaces/project-1/plan-items/plan-1/dispatch', '/v1/tasks/task-1/accept',
    ]);
    expect(requests[0].body).toEqual({ userIds: ['member-1'], version: 3 });
    expect(requests[1].body).toEqual({ network: 'project-1' });
  });

  it('configures execution separately and submits without setting done', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(init.body as string) });
      return { ok: true, json: async () => ({ data: { ...task, status: 'need_input', submitted_summary: '完成部署验证' } }) };
    }));
    workspaceApi.configure('project-1', 'test-token');

    await workspaceApi.configureTask('task-1', { mode: 'workflow', workflowId: 'workflow-1', knowledgeIds: ['kb-1'], fileIds: [] });
    const submitted = await workspaceApi.submitTask('task-1', '完成部署验证');
    await workspaceApi.stopMemberTask('task-1');

    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      '/v1/tasks/task-1/configure', '/v1/tasks/task-1/submit', '/v1/tasks/task-1/stop',
    ]);
    expect(requests[0].body).toMatchObject({ mode: 'workflow', workflow_id: 'workflow-1', knowledge_ids: ['kb-1'] });
    expect(requests[1].body).toMatchObject({ summary: '完成部署验证' });
    expect(submitted).toMatchObject({ status: 'need_input', submittedSummary: '完成部署验证' });
  });
});
