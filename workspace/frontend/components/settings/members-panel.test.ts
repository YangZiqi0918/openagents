// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceApi } from '@/lib/api';
import type { WorkspaceMe } from '@/lib/types';
import { MembersPanel } from './members-panel';

vi.mock('@/lib/api-config', () => ({ IS_LOCAL_AUTH: true }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ locale: 'en-US' }), useT: () => (key: string) => key }));
vi.mock('@/components/ui/dialogs-provider', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));
let root: Root;
let container: HTMLDivElement;
let api: { getTeam: ReturnType<typeof vi.fn>; listInvites: ReturnType<typeof vi.fn>; createInvite: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  api = { getTeam: vi.fn().mockResolvedValue([{ email: 'private-key@local.invalid', username: 'alice', displayName: 'Alice', role: 'owner', avatarUrl: null }]), listInvites: vi.fn().mockResolvedValue([]), createInvite: vi.fn().mockRejectedValue(new Error('Username not found')) };
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const render = async (role: string) => { await act(() => root.render(React.createElement(MembersPanel, { api: api as unknown as WorkspaceApi, me: { email: 'private-key@local.invalid', role, effectiveRole: role } as WorkspaceMe }))); };

describe('project human members', () => {
  it('loads members for viewers without requesting admin invites or exposing internal identities', async () => {
    await render('viewer');
    expect(api.getTeam).toHaveBeenCalledOnce();
    expect(api.listInvites).not.toHaveBeenCalled();
    expect(container.textContent).toContain('alice');
    expect(container.textContent).not.toContain('private-key@local.invalid');
    expect(container.querySelector('form')).toBeNull();
  });
  it('shows permission/load failures instead of an empty member list', async () => {
    api.getTeam.mockRejectedValue(new Error('Project access revoked'));
    await render('viewer');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Project access revoked');
    expect(container.textContent).not.toContain('admin.noMembers');
  });
  it('sends a username-targeted invite and reports an unknown account', async () => {
    await render('owner');
    const input = container.querySelector<HTMLInputElement>('input')!;
    await act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'bob'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(api.createInvite).toHaveBeenCalledWith('member', undefined, 'bob');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Username not found');
    expect(container.querySelector<HTMLButtonElement>('[aria-label="admin.removeMember"]')?.disabled).toBe(true);
  });
});
