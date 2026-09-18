// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ firebaseLoaded: vi.fn(), loadSession: vi.fn(), clearSession: vi.fn() }));
vi.mock('./api-config', () => ({ IS_LOCAL_MODE: true, IS_LOCAL_AUTH: false }));
vi.mock('./workspace-session', () => ({ loadWorkspaceSession: mocks.loadSession, clearWorkspaceSession: mocks.clearSession }));
vi.mock('./firebase', () => { mocks.firebaseLoaded(); return {}; });
import { OpenAgentsAuthProvider, useOpenAgentsAuth } from './openagents-auth-context';

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('local authentication', () => {
  it('does not load Firebase or restore an online session, even on localhost', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let auth: ReturnType<typeof useOpenAgentsAuth>;
    function Probe() {
      auth = useOpenAgentsAuth();
      return React.createElement('span', null, String(auth.loading));
    }
    try {
      await act(() => root.render(React.createElement(OpenAgentsAuthProvider, null, React.createElement(Probe))));
      expect(auth!.loading).toBe(false);
      expect(auth!.user).toBeNull();
      expect(auth!.idToken).toBeNull();
      expect(auth!.isOpenAgentsDomain).toBe(false);
      await act(async () => { await auth!.signIn(); await auth!.signOut(); });
      expect(mocks.firebaseLoaded).not.toHaveBeenCalled();
      expect(mocks.loadSession).not.toHaveBeenCalled();
    } finally {
      await act(() => root.unmount());
      container.remove();
    }
  });
});
