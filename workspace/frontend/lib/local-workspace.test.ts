import { afterEach, describe, expect, it, vi } from 'vitest';

const mode = vi.hoisted(() => ({ local: true }));
vi.mock('./api-config', () => ({ API_URL: 'http://127.0.0.1:18000', get IS_LOCAL_MODE() { return mode.local; } }));
import { requestLocalWorkspaceAccess } from './local-workspace';

const credentials = { workspaceId: 'local-id', slug: 'local', name: 'Local Workspace', token: 'local-token' };

afterEach(() => { vi.unstubAllGlobals(); mode.local = true; });

describe('local workspace credentials', () => {
  it('requests only the local endpoint without identity credentials', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: credentials }) });
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    expect(await requestLocalWorkspaceAccess('local', signal)).toEqual(credentials);
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:18000/v1/workspaces/local-access', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{"workspace_id":"local"}', cache: 'no-store', signal,
    });
  });

  it('does not request local access in hosted mode', async () => {
    mode.local = false;
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(requestLocalWorkspaceAccess()).rejects.toThrow('disabled');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports backend errors without falling back to the hosted API', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetch);
    await expect(requestLocalWorkspaceAccess()).rejects.toThrow('404');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects malformed credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) }));
    await expect(requestLocalWorkspaceAccess()).rejects.toThrow('Invalid');
  });
});
