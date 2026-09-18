// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ pathname: '/', personal: vi.fn(), replace: vi.fn(), push: vi.fn(), user: { id: 'account-one', email: 'identity@local.invalid', username: 'alice' }, navigation: { setDraftThreadOpen: vi.fn(), openMobileDetail: vi.fn(), viewMode: 'threads', setViewMode: vi.fn() } }));
vi.mock('next/navigation', () => ({ usePathname: () => mock.pathname, useRouter: () => ({ replace: mock.replace, push: mock.push }) }));
vi.mock('@/lib/api-config', () => ({ IS_LOCAL_AUTH: true }));
vi.mock('@/lib/account-api', () => ({ getPersonalSpace: mock.personal }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => ({ user: mock.user, idToken: 'account-jwt', loading: false }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ locale: 'en-US' }) }));
vi.mock('@/lib/workspace-context', () => ({ WorkspaceProvider: ({ children, workspaceId, scopeFilter }: { children: React.ReactNode; workspaceId: string; scopeFilter: string }) => React.createElement('div', { 'data-scope': scopeFilter, 'data-container': workspaceId }, children) }));
vi.mock('./layout-context', () => ({ useLayout: () => mock.navigation, LayoutProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./wrapper', () => ({ Wrapper: ({ projectContent }: { projectContent?: React.ReactNode }) => React.createElement(TestComposer, { projectContent }) }));
import { LocalAccountShell } from './local-account-shell';

function TestComposer({ projectContent }: { projectContent?: React.ReactNode }) {
  const [draft, setDraft] = useState('');
  return React.createElement('main', null, React.createElement('textarea', { value: draft, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value) }), React.createElement('section', null, projectContent));
}
let root: Root;
let element: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); mock.pathname = '/'; mock.personal.mockResolvedValue({ workspaceId: 'private-one', kind: 'personal' }); element = document.createElement('div'); document.body.appendChild(element); root = createRoot(element); });
afterEach(async () => { await act(() => root.unmount()); element.remove(); vi.unstubAllGlobals(); });

describe('personal shell across project navigation', () => {
  it('keeps the personal provider and composer mounted when only project contents switch', async () => {
    const render = (children: React.ReactNode) => act(() => root.render(React.createElement(LocalAccountShell, { children })));
    await render(null);
    const input = element.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Personal draft'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    for (const id of ['project-a', 'project-b']) { mock.pathname = `/projects/${id}`; await render(React.createElement('p', null, id)); expect(element.querySelector('section')?.textContent).toBe(id); expect(element.querySelector('textarea')).toBe(input); expect(input.value).toBe('Personal draft'); }
    expect(mock.personal).toHaveBeenCalledOnce();
    expect(element.querySelector('[data-scope="personal"]')?.getAttribute('data-container')).toBe('private-one');
  });
});
