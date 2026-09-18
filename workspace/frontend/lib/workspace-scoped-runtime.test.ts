// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-config', () => ({ API_URL: 'http://local-api', IS_LOCAL_AUTH: true }));
vi.mock('./analytics', () => ({ capture: vi.fn(), group: vi.fn() }));
vi.mock('./openagents-auth-context', () => ({ useOpenAgentsAuth: () => ({ user: { email: 'stable-user@internal', displayName: 'alice' } }) }));

import { WorkspaceProvider, useWorkspace } from './workspace-context';
import { workspaceApi } from './api';

let root: Root;
let container: HTMLDivElement;
let projectAllowed: boolean;
let projectRole: 'member' | 'viewer';
const states = new Map<string, ReturnType<typeof useWorkspace>>();

function json(data: unknown) {
  return new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
}

function View({ id }: { id: string }) {
  const state = useWorkspace();
  states.set(id, state);
  return React.createElement('div', { 'data-scope': id }, `${state.api.getScopeId()}:${state.canWrite}:${state.files.map((file) => file.filename).join(',')}`);
}

function Screen({ projectId = 'project-a' }: { projectId?: string }) {
  return React.createElement(WorkspaceProvider, {
    workspaceId: 'personal', token: 'do-not-use', bearerToken: 'account-session', scopeFilter: 'personal',
    children: [React.createElement(View, { key: 'personal-view', id: 'personal' }), React.createElement(WorkspaceProvider, {
      key: 'project-runtime', workspaceId: projectId, token: 'do-not-use', bearerToken: 'account-session', scopeFilter: 'project', children: React.createElement(View, { id: 'project' }),
    })],
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  projectAllowed = true;
  projectRole = 'member';
  states.clear();
  vi.stubGlobal('fetch', vi.fn(async (rawUrl: string) => {
    const url = new URL(rawUrl);
    const scope = url.searchParams.get('network') || url.pathname.split('/')[3];
    if (url.pathname.endsWith('/me')) {
      if (scope !== 'personal' && !projectAllowed) return new Response('project membership removed', { status: 403 });
      const role = scope === 'personal' ? 'owner' : projectRole;
      return json({ authenticated: true, role, effectiveRole: role });
    }
    if (url.pathname === '/v1/discover') return json({ agents: [], channels: [{ address: 'channel/welcome', title: 'Welcome', participants: [] }, { address: 'channel/task:run', title: 'Hidden execution', participants: [] }] });
    if (/^\/v1\/workspaces\/[^/]+$/.test(url.pathname)) return json({ workspaceId: scope, name: scope, agents: [] });
    if (url.pathname === '/v1/files') return json({ files: [{ id: `${scope}-file`, filename: `${scope}.txt`, size: 1, content_type: 'text/plain' }], total: 1 });
    if (url.pathname === '/v1/browser/tabs') return json({ tabs: [] });
    if (url.pathname === '/v1/browser/contexts') return json({ contexts: [] });
    if (url.pathname === '/v1/events/conversations') return json({ conversations: [] });
    if (url.pathname === '/v1/events/latest-per-channel') return json({ channels: {} });
    return json({ events: [], has_more: false });
  }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('nested personal and project runtime', () => {
  it('preserves the personal client and selection when the selected project changes', async () => {
    await act(async () => root.render(React.createElement(Screen)));
    const personalApi = states.get('personal')!.api;
    await act(async () => states.get('personal')!.setCurrentSessionId('personal-draft'));
    await act(async () => root.render(React.createElement(Screen, { projectId: 'project-b' })));
    expect(states.get('personal')!.api).toBe(personalApi);
    expect(states.get('personal')!.currentSessionId).toBe('personal-draft');
    expect(states.get('project')!.api.getScopeId()).toBe('project-b');
    expect(states.get('project')!.files[0].filename).toBe('project-b.txt');
    expect(states.get('project')!.sessions.map((session) => session.sessionId)).toEqual(['welcome']);
    expect(workspaceApi.isConfigured()).toBe(false);
  });

  it('updates write ability when the current project role changes', async () => {
    await act(async () => root.render(React.createElement(Screen)));
    expect(states.get('project')!.canWrite).toBe(true);
    projectRole = 'viewer';
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(states.get('project')!.canWrite).toBe(false);
    expect(states.get('personal')!.canWrite).toBe(true);
  });

  it('unmounts revoked project content within five seconds without revoking the personal account', async () => {
    await act(async () => root.render(React.createElement(Screen)));
    const personalApi = states.get('personal')!.api;
    const projectApi = states.get('project')!.api;
    projectAllowed = false;
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(container.querySelector('[data-scope="project"]')).toBeNull();
    expect(container.textContent).not.toContain('project-a.txt');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('membership removed');
    expect(container.querySelector('[data-scope="personal"]')?.textContent).toContain('personal.txt');
    await expect(projectApi.listFiles()).rejects.toThrow('revoked');
    await expect(personalApi.getMe()).resolves.toMatchObject({ role: 'owner' });
  });
});
