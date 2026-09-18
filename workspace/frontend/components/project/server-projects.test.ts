// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectsView } from './projects-view';

const mock = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn(), prompt: vi.fn(), push: vi.fn(), translate: (key: string) => key }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mock.push }) }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => ({ idToken: 'account-jwt' }) }));
vi.mock('@/lib/account-api', () => ({ listAccountWorkspaces: mock.list, createAccountWorkspace: mock.create, renameAccountProject: mock.rename, deleteAccountProject: mock.remove }));
vi.mock('@/lib/i18n', () => ({ useT: () => mock.translate, useI18n: () => ({ locale: 'en-US' }) }));
vi.mock('@/components/ui/dialogs-provider', () => ({ usePrompt: () => mock.prompt, useConfirm: () => vi.fn().mockResolvedValue(true) }));
vi.mock('./project-internal-page', () => ({ ProjectInternalPage: () => null }));
let container: HTMLDivElement;
let root: Root;
const project = { workspaceId: 'real-project', name: 'Shared project', slug: 'shared-project', role: 'viewer', kind: 'project', createdAt: '2026-09-18T00:00:00Z' };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  mock.list.mockResolvedValue([project]); mock.prompt.mockResolvedValue('New project');
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = () => act(() => root.render(React.createElement(ProjectsView, { serverBacked: true })));
const button = (text: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((element) => element.textContent === text)!;

describe('server-backed project entry', () => {
  it('opens authorized project IDs and does not expose admin controls to viewers', async () => {
    await render();
    expect(mock.list).toHaveBeenCalledWith('account-jwt');
    expect(container.querySelectorAll('[data-testid="project-card"]')).toHaveLength(1);
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
    await act(() => container.querySelector<HTMLButtonElement>('[data-testid="project-card"] button')!.click());
    expect(mock.push).toHaveBeenCalledWith('/projects/real-project');
  });
  it('creates once and navigates with the returned server identity, without local storage writes', async () => {
    const save = vi.spyOn(Storage.prototype, 'setItem');
    let resolve: (value: unknown) => void;
    mock.create.mockImplementation(() => new Promise((complete) => { resolve = complete; }));
    await render();
    await act(() => button('projects.newProject').click());
    await act(() => button('projects.newProject').click());
    expect(mock.create).toHaveBeenCalledOnce();
    expect(mock.create).toHaveBeenCalledWith('account-jwt', 'New project', '', undefined);
    await act(() => resolve!({ ...project, workspaceId: 'created-project', name: 'New project', role: 'owner' }));
    expect(mock.push).toHaveBeenCalledWith('/projects/created-project');
    expect(save).not.toHaveBeenCalled(); save.mockRestore();
  });
});
