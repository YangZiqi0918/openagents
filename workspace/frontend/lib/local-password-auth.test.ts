// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ load: vi.fn(), clear: vi.fn(), login: vi.fn(), profile: vi.fn(), firebase: vi.fn(), host: vi.fn() }));
vi.mock('./api-config', () => ({ IS_LOCAL_AUTH: true, IS_LOCAL_MODE: false }));
vi.mock('./workspace-session', () => ({ loadWorkspaceSession: mock.load, clearWorkspaceSession: mock.clear, authenticateLocalAccount: mock.login }));
vi.mock('./account-api', () => ({ getAccountProfile: mock.profile }));
vi.mock('./firebase', () => { mock.firebase(); return {}; });
vi.mock('./desktop-host', () => ({ desktopHost: mock.host }));
import { OpenAgentsAuthProvider, useOpenAgentsAuth } from './openagents-auth-context';

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); mock.load.mockReturnValue(null); });
afterEach(() => { vi.unstubAllGlobals(); });

async function probe(check: (auth: ReturnType<typeof useOpenAgentsAuth>) => Promise<void>) {
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  let auth: ReturnType<typeof useOpenAgentsAuth>;
  const Probe = () => { auth = useOpenAgentsAuth(); return null; };
  try { await act(() => root.render(React.createElement(OpenAgentsAuthProvider, null, React.createElement(Probe)))); await check(auth!); }
  finally { await act(() => root.unmount()); element.remove(); }
}

describe('local authenticated account', () => {
  it('verifies a restored session without loading remote identity providers', async () => {
    mock.load.mockReturnValue({ token: 'local-jwt', source: 'local_password', email: 'identity@local.invalid', userId: 'one', username: 'alice' });
    mock.profile.mockResolvedValue({ userId: 'one', username: 'alice', displayName: 'Alice', avatarUrl: null });
    await probe(async (auth) => {
      expect(mock.profile).toHaveBeenCalledWith('local-jwt');
      expect(auth.user).toMatchObject({ id: 'one', username: 'alice', source: 'local_password' });
      expect(auth.idToken).toBe('local-jwt');
      expect(auth.loading).toBe(false);
      await act(() => auth.signOut());
    });
    expect(mock.firebase).not.toHaveBeenCalled(); expect(mock.host).not.toHaveBeenCalled();
  });
  it('rejects invalid sessions instead of falling back to remote or anonymous sessions', async () => {
    mock.load.mockReturnValue({ token: 'expired', source: 'local_password', email: 'identity@local.invalid' });
    mock.profile.mockRejectedValue(new Error('Invalid session'));
    await probe(async (auth) => { expect(auth.user).toBeNull(); expect(auth.idToken).toBeNull(); expect(auth.loading).toBe(false); });
    expect(mock.clear).toHaveBeenCalled(); expect(mock.firebase).not.toHaveBeenCalled(); expect(mock.host).not.toHaveBeenCalled();
  });
  it('ignores handoff sessions in local password mode', async () => {
    mock.load.mockReturnValue({ token: 'remote', source: 'handoff', email: 'someone@example.com' });
    await probe(async (auth) => { expect(auth.user).toBeNull(); expect(auth.idToken).toBeNull(); });
    expect(mock.profile).not.toHaveBeenCalled(); expect(mock.clear).toHaveBeenCalled();
  });
});
