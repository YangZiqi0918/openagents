// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceProvider, useWorkspace } from './workspace-context';

const api = vi.hoisted(() => Object.fromEntries([
  'configure', 'setCredentials', 'isAccessRevoked', 'getWorkspace', 'discover', 'listFiles', 'listTrash',
  'listBrowserTabs', 'listBrowserContexts', 'listTodos', 'listTasks',
  'listWorkflows', 'listRoutines', 'listKnowledge', 'listNotifications',
  'listConversations', 'latestPerChannel', 'createChannel', 'sendMessage', 'updateChannel',
].map((name) => [name, vi.fn()])));

vi.mock('./api', () => ({
  workspaceApi: api,
  WorkspaceApi: vi.fn(function (workspaceId: string, token: string, bearerToken: string) {
    api.configure(workspaceId, token, bearerToken);
    return api;
  }),
}));
vi.mock('./analytics', () => ({ capture: vi.fn(), group: vi.fn() }));
vi.mock('./openagents-auth-context', () => ({ useOpenAgentsAuth: () => ({ user: null }) }));
vi.mock('./identity', () => ({
  getStoredIdentity: () => ({ id: '', name: '' }),
  generateUserId: () => '', storeIdentity: vi.fn(),
}));
vi.mock('@/hooks/use-upload-queue', () => ({
  useUploadQueue: () => ({ uploads: [], enqueueUploads: vi.fn(), retryUpload: vi.fn(), cancelUpload: vi.fn() }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let root: Root;
let container: HTMLDivElement;
let state: ReturnType<typeof useWorkspace> | undefined;

function View() {
  state = useWorkspace();
  return React.createElement('div', null, state.loading ? 'Loading' : state.error || state.workspace?.name);
}

async function render(workspaceId = 'one') {
  await act(async () => {
    root.render(React.createElement(WorkspaceProvider, {
      workspaceId, token: 'test-token', children: React.createElement(View),
    }));
  });
}

function essentials(name = 'Workspace one') {
  api.getWorkspace.mockResolvedValue({ name });
  api.discover.mockResolvedValue({
    agents: [{ address: 'openagents:helper', role: 'member', status: 'online' }],
    channels: [{ address: 'channel/general', title: 'General', participants: ['helper'], last_event_at: 1 }],
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Node's native localStorage can shadow jsdom's storage in newer runtimes.
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  state = undefined;
  for (const method of Object.values(api)) {
    method.mockReset().mockImplementation(() => new Promise(() => {}));
  }
  api.isAccessRevoked.mockReturnValue(false);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('workspace initial loading', () => {
  it('excludes project channels from personal selection, refreshes and preview caches', async () => {
    essentials();
    const personal = { address: 'channel/general', title: 'General', participants: ['helper'], last_event_at: 1 };
    const project = { address: 'channel/project:one:abc', title: 'Project', participants: [], last_event_at: 999999 };
    api.discover.mockResolvedValue({ agents: [], channels: [project, personal] });
    localStorage.setItem('previews:one', JSON.stringify({ general: { content: 'Personal' }, 'project:one:abc': { content: 'Project secret' } }));
    api.latestPerChannel.mockResolvedValue({ channels: {
      general: { source: 'human:user', payload: { content: 'Personal latest' } },
      'project:one:abc': { source: 'human:user', payload: { content: 'Project latest', message_type: 'thinking' } },
    } });
    await render();
    expect(state!.sessions.map((session) => session.sessionId)).toEqual(['general']);
    expect(state!.currentSessionId).toBe('general');
    expect(Object.keys(state!.lastMessageBySession)).toEqual(['general']);
    expect(localStorage.getItem('previews:one')).not.toContain('project:');
    await act(async () => state!.refreshAgents());
    expect(state!.sessions.map((session) => session.sessionId)).toEqual(['general']);
    expect(state!.activeSessionIds.size).toBe(0);
  });
  it('shows the workspace, agents and threads while optional requests and previews are still pending', async () => {
    essentials();
    const tabs = deferred<{ tabs: unknown[] }>();
    api.listBrowserTabs.mockReturnValue(tabs.promise);
    await render();

    expect(container.textContent).toBe('Workspace one');
    expect(state?.loading).toBe(false);
    expect(state?.agents[0].agentName).toBe('helper');
    expect(state?.sessions[0].sessionId).toBe('general');
    expect(api.latestPerChannel).toHaveBeenCalledOnce();
    expect(state?.browserTabs).toEqual([]);

    await act(async () => tabs.resolve({ tabs: [{ id: 'tab-one', title: 'Browser' }] }));
    expect(state?.browserTabs[0].id).toBe('tab-one');
    expect(state?.loading).toBe(false);
  });

  it('keeps optional failures out of the workspace error state', async () => {
    essentials();
    api.listBrowserTabs.mockRejectedValue(new Error('Browser unavailable'));
    api.latestPerChannel.mockRejectedValue(new Error('Previews unavailable'));
    await render();
    expect(container.textContent).toBe('Workspace one');
    expect(state?.error).toBeNull();
  });

  it('waits for essential discovery and shows an essential failure, then recovers on a new workspace', async () => {
    essentials();
    const discovery = deferred<unknown>();
    api.discover.mockReturnValue(discovery.promise);
    await render();
    expect(container.textContent).toBe('Loading');
    expect(api.listBrowserTabs).not.toHaveBeenCalled();
    await act(async () => discovery.reject(new Error('Access denied')));
    expect(container.textContent).toBe('Access denied');
    essentials('Workspace two');
    await render('two');
    expect(container.textContent).toBe('Workspace two');
    expect(state?.error).toBeNull();
  });

  it('clears old optional data and ignores late responses after switching workspaces', async () => {
    essentials();
    const oldTabs = deferred<{ tabs: unknown[] }>();
    const oldPreviews = deferred<unknown>();
    api.listBrowserTabs.mockReturnValueOnce(oldTabs.promise);
    api.latestPerChannel.mockReturnValueOnce(oldPreviews.promise);
    api.listTodos.mockResolvedValueOnce({ todos: [{ id: 'old-todo' }] });
    await render();
    expect(state?.todos).toHaveLength(1);

    essentials('Workspace two');
    await render('two');
    expect(state?.todos).toEqual([]);
    await act(async () => {
      oldTabs.resolve({ tabs: [{ id: 'old-tab' }] });
      oldPreviews.resolve({ channels: { general: { source: 'openagents:old', payload: { content: 'Old preview' } } } });
    });
    expect(container.textContent).toBe('Workspace two');
    expect(state?.browserTabs).toEqual([]);
    expect(state?.lastMessageBySession).toEqual({});
    expect(localStorage.getItem('previews:one')).toBeNull();
  });

  it('adds a new conversation only after its first message succeeds', async () => {
    essentials();
    await render();
    const sent = deferred<unknown>();
    const newSession = { ...state!.sessions[0], sessionId: 'new-thread', title: 'First message' };
    api.createChannel.mockResolvedValue(newSession);
    api.sendMessage.mockReturnValue(sent.promise);

    let pending!: Promise<typeof newSession>;
    await act(async () => {
      pending = state!.createAndSendSession({ content: 'First message', participants: ['helper'], files: [] });
      await Promise.resolve();
    });
    expect(state!.sessions.map((item) => item.sessionId)).toEqual(['general']);
    expect(state!.currentSessionId).not.toBe('new-thread');
    const discoveryCalls = api.discover.mock.calls.length;
    await act(async () => { await state!.refreshAgents(); });
    expect(api.discover).toHaveBeenCalledTimes(discoveryCalls);

    await act(async () => { sent.resolve({}); await pending; });
    expect(state!.sessions.filter((item) => item.sessionId === 'new-thread')).toHaveLength(1);
    expect(state!.currentSessionId).toBe('new-thread');
  });

  it('leaves failed first sends out of the list and removes their empty channel', async () => {
    essentials();
    await render();
    api.createChannel.mockResolvedValue({ ...state!.sessions[0], sessionId: 'failed-thread' });
    api.sendMessage.mockRejectedValue(new Error('send failed'));
    api.updateChannel.mockResolvedValue(undefined);

    await act(async () => {
      await expect(state!.createAndSendSession({ content: 'Try again', participants: ['helper'], files: [] }))
        .rejects.toThrow('send failed');
    });
    expect(api.updateChannel).toHaveBeenCalledWith('failed-thread', { status: 'deleted' });
    expect(state!.sessions.some((item) => item.sessionId === 'failed-thread')).toBe(false);
    expect(state!.currentSessionId).not.toBe('failed-thread');
  });
});
