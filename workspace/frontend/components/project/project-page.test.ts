// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ getWorkspace: vi.fn(), getMe: vi.fn(), push: vi.fn(), replace: vi.fn(), clients: vi.fn(), search: 'projectName=Untrusted&session=welcome', pageProps: {} as Record<string, unknown> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mock.push, replace: mock.replace }), useSearchParams: () => new URLSearchParams(mock.search) }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => ({ idToken: 'account-jwt' }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ locale: 'en-US' }) }));
vi.mock('@/lib/api', () => ({ WorkspaceApi: class { constructor(id: string, token: string, bearer: string) { mock.clients(id, token, bearer); } getWorkspace = mock.getWorkspace; getMe = mock.getMe; } }));
vi.mock('@/lib/workspace-context', () => ({ WorkspaceProvider: ({ workspaceId, scopeFilter, children }: { workspaceId: string; scopeFilter: string; children: React.ReactNode }) => React.createElement('div', { 'data-scope': scopeFilter, 'data-project': workspaceId }, children) }));
vi.mock('@/components/layout/layout-context', () => ({ LayoutProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./project-internal-page', () => ({ ProjectInternalPage: (props: Record<string, unknown>) => { mock.pageProps = props; return React.createElement('p', null, props.projectName as string); } }));
import { ProjectPage } from './project-page';
let element: HTMLDivElement;
let root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); mock.search = 'projectName=Untrusted&session=welcome'; mock.pageProps = {}; mock.getMe.mockResolvedValue({ role: 'owner' }); element = document.createElement('div'); document.body.appendChild(element); root = createRoot(element); });
afterEach(async () => { await act(() => root.unmount()); element.remove(); vi.unstubAllGlobals(); });

describe('real project context boot', () => {
  it('loads server metadata and rejects using URL names as authoritative', async () => {
    mock.getWorkspace.mockResolvedValue({ workspaceId: 'real-one', kind: 'project', name: 'Server name' });
    await act(() => root.render(React.createElement(ProjectPage, { projectId: 'real-one' })));
    expect(mock.clients).toHaveBeenCalledWith('real-one', '', 'account-jwt');
    expect(element.textContent).toContain('Server name'); expect(element.textContent).not.toContain('Untrusted');
    expect(element.querySelector('[data-scope="project"]')?.getAttribute('data-project')).toBe('real-one');
  });
  it('retries project loading rather than creating another container after navigation fails', async () => {
    mock.getWorkspace.mockRejectedValueOnce(new Error('Temporarily unavailable')).mockResolvedValue({ workspaceId: 'real-one', kind: 'project', name: 'Opened project' });
    await act(() => root.render(React.createElement(ProjectPage, { projectId: 'real-one' })));
    expect(element.querySelector('[role="alert"]')?.textContent).toBe('Temporarily unavailable');
    const retry = Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Retry')!;
    await act(() => retry.click());
    expect(mock.getWorkspace).toHaveBeenCalledTimes(2); expect(element.textContent).toContain('Opened project');
  });
  it('does not render a private container as a project', async () => {
    mock.getWorkspace.mockResolvedValue({ workspaceId: 'private-one', kind: 'personal', name: 'Private' });
    await act(() => root.render(React.createElement(ProjectPage, { projectId: 'private-one' })));
    expect(element.querySelector('[role="alert"]')?.textContent).toBe('This address is not a project.');
    expect(element.querySelector('[data-scope="project"]')).toBeNull();
  });
  it('keeps plan task detail state in the URL and preserves the plan item when closing', async () => {
    mock.search = 'tab=plan&item=plan-1&task=task-1&view=comments';
    mock.getWorkspace.mockResolvedValue({ workspaceId: 'real-one', kind: 'project', name: 'Server name' });
    await act(() => root.render(React.createElement(ProjectPage, { projectId: 'real-one' })));
    expect(mock.pageProps).toMatchObject({
      initialTab: 'plan', initialPlanItemId: 'plan-1', initialPlanTaskId: 'task-1', initialPlanTaskView: 'comments',
    });
    await act(() => (mock.pageProps.onPlanTaskViewChange as (view: string) => void)('history'));
    expect(mock.replace).toHaveBeenCalledWith('/projects/real-one?tab=plan&item=plan-1&task=task-1&view=history');
    await act(() => (mock.pageProps.onClosePlanTask as () => void)());
    expect(mock.push).toHaveBeenCalledWith('/projects/real-one?tab=plan&item=plan-1');
  });
});
