// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticateLocalAccount, loadWorkspaceSession } from './workspace-session';

vi.mock('./api-config', () => ({ API_URL: 'http://localhost:8000' }));

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

describe('local password session', () => {
  it('persists a local account identity and sends only username/password', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { session_token: 'local-jwt', expires_at: new Date(Date.now() + 86400000).toISOString(), user: { id: 'user-id', username: 'alice', display_name: 'alice', identity_key: 'private-identity@local.invalid' } } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await authenticateLocalAccount('register', ' Alice ', 'simple-password');
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:8000/v1/auth/local/register');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ username: 'Alice', password: 'simple-password' });
    expect(loadWorkspaceSession()).toMatchObject({ token: 'local-jwt', source: 'local_password', userId: 'user-id', username: 'alice', email: 'private-identity@local.invalid' });
  });

  it('does not store an unsuccessful login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Invalid credentials' }), { status: 401 })));
    await expect(authenticateLocalAccount('login', 'alice', 'wrong')).rejects.toThrow('Invalid credentials');
    expect(loadWorkspaceSession()).toBeNull();
  });
});
