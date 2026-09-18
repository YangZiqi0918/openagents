import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-config', () => ({ API_URL: 'http://local-api', IS_LOCAL_AUTH: true }));

import { WorkspaceApi, WorkspaceApiError, workspaceApi } from './api';

afterEach(() => vi.unstubAllGlobals());

function json(data: unknown) {
  return new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
}

describe('scoped local account API', () => {
  it('keeps simultaneous personal and project requests independently scoped', async () => {
    const calls: { url: string; headers: Headers }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      calls.push({ url, headers: new Headers(options.headers) });
      return json({ tasks: [] });
    }));
    const personal = new WorkspaceApi('personal-id', 'private-machine-token', 'account-session');
    const project = new WorkspaceApi('project-id', 'project-machine-token', 'account-session');
    await Promise.all([personal.listTasks(), project.listTasks()]);
    expect(calls.map(({ url }) => new URL(url).searchParams.get('network'))).toEqual(['personal-id', 'project-id']);
    for (const { headers } of calls) {
      expect(headers.get('Authorization')).toBe('Bearer account-session');
      expect(headers.has('X-Workspace-Token')).toBe(false);
    }
    expect(workspaceApi.isConfigured()).toBe(false);
  });

  it('permits credential renewal but never changing the client identity', async () => {
    const fetchMock = vi.fn(async (_url: string, _options: RequestInit) => json({ workspaceId: 'project-id' }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new WorkspaceApi('project-id', '', 'old-session');
    api.setCredentials('ignored-machine-token', 'renewed-session');
    await api.getWorkspace();
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer renewed-session');
    expect(() => api.configure('another-project', '', 'renewed-session')).toThrow('cannot change project identity');
    expect(api.getScopeId()).toBe('project-id');
  });

  it('fetches preview and download bytes with identity headers, not a URL credential', async () => {
    const fetchMock = vi.fn(async (_url: string, _options: RequestInit) => new Response('file contents', { headers: { 'Content-Type': 'text/plain' } }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new WorkspaceApi('project-id', 'hidden-token', 'account-session');
    expect(await api.getFileText('file-id')).toBe('file contents');
    const blob = await api.getFileBlob('file-id', { contentType: 'application/pdf' });
    expect(blob.type).toBe('application/pdf');
    for (const [url, options] of fetchMock.mock.calls) {
      expect(url).toBe('http://local-api/v1/files/file-id');
      expect(new Headers(options.headers).get('Authorization')).toBe('Bearer account-session');
    }
    expect(api.getFileUrl('file-id')).not.toContain('token=');
  });

  it('surfaces access failures without silently treating denied lists as empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not a member', { status: 401 })));
    const api = new WorkspaceApi('project-id', '', 'account-session');
    const listener = vi.fn();
    const unsubscribe = api.onAccessFailure(listener);
    await expect(api.listTasks()).rejects.toBeInstanceOf(WorkspaceApiError);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
    unsubscribe();
  });

  it('drops a response completed after access was revoked and pauses subsequent requests', async () => {
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((yes) => { resolve = yes; }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new WorkspaceApi('project-id', '', 'account-session');
    const pending = api.listTasks();
    api.revokeAccess();
    resolve(json({ tasks: [{ id: 'protected-resource' }] }));
    await expect(pending).rejects.toThrow('revoked');
    await expect(api.listTasks()).rejects.toThrow('revoked');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not create publicly accessible snapshots in local account mode', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const api = new WorkspaceApi('project-id', '', 'account-session');
    await expect(api.createShare('welcome')).rejects.toThrow('disabled');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
