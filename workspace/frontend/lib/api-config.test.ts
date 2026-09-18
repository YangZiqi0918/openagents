import { describe, expect, it } from 'vitest';
import { resolveApiUrl } from './api-config';

describe('workspace API configuration', () => {
  it('defaults to the local backend in local mode', () => {
    expect(resolveApiUrl(undefined, true)).toBe('http://localhost:8000');
  });

  it('keeps hosted configuration outside local mode', () => {
    expect(resolveApiUrl(undefined, false)).toBe('https://workspace-endpoint.openagents.org');
    expect(resolveApiUrl('https://self-hosted.example/api/', false)).toBe('https://self-hosted.example/api');
  });

  it('uses explicitly configured loopback endpoints', () => {
    expect(resolveApiUrl('http://127.0.0.1:18000/', true)).toBe('http://127.0.0.1:18000');
  });

  it.each(['https://workspace-endpoint.openagents.org', 'https://other.example', 'http://localhost.example:8000', 'ftp://localhost:8000'])(
    'rejects non-local endpoint %s in local mode', (url) => {
      expect(() => resolveApiUrl(url, true)).toThrow('loopback');
    },
  );
});
