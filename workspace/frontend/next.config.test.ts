import { afterEach, describe, expect, it, vi } from 'vitest';

async function config(local: boolean) {
  vi.stubEnv('NEXT_PUBLIC_LOCAL_MODE', String(local));
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://127.0.0.1:18000');
  vi.stubEnv('API_INTERNAL_URL', 'http://backend:8000');
  vi.resetModules();
  const path = './next.config.mjs';
  return (await import(path)).default;
}

afterEach(() => vi.unstubAllEnvs());

describe('local Next.js configuration', () => {
  it('proxies API requests to the local container instead of the hosted endpoint', async () => {
    const rewrites = await (await config(true)).rewrites();
    expect(rewrites.afterFiles).toEqual([{ source: '/wsapi/:path*', destination: 'http://backend:8000/:path*' }]);
  });

  it('blocks external browser connections and resources in local mode', async () => {
    const headers = await (await config(true)).headers();
    const policy = headers[0].headers[0].value as string;
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("connect-src 'self' http://localhost:*");
    expect(policy).not.toContain('openagents.org');
  });

  it('redirects obsolete login callbacks to the local entry point', async () => {
    const redirects = await (await config(true)).redirects();
    expect(redirects).toContainEqual({ source: '/auth/callback', destination: '/', permanent: false });
    expect(redirects).toContainEqual({ source: '/auth/desktop', destination: '/', permanent: false });
    expect(redirects.every((item: { destination: string }) => item.destination === '/')).toBe(true);
  });

  it('does not change hosted resource or auth policy', async () => {
    const hosted = await config(false);
    expect(await hosted.headers()).toEqual([]);
    expect((await hosted.redirects()).some((item: { source: string }) => item.source.startsWith('/auth/'))).toBe(false);
  });
});
