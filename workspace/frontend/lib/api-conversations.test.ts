import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceApi } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('workspace direct conversations', () => {
  it('loads every page rather than stopping at the first 100 conversations', async () => {
    const urls: string[] = [];
    const conversation = (index: number) => ({
      agents: ['human:user', `openagents:agent-${index}`],
      last_message: { content: 'hello', sender: 'human:user', timestamp: index },
      message_count: 1,
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      const offset = Number(new URL(url).searchParams.get('offset'));
      const conversations = offset === 0
        ? Array.from({ length: 100 }, (_, index) => conversation(index))
        : [conversation(100)];
      return { ok: true, json: async () => ({ data: { conversations } }) };
    }));
    workspaceApi.configure('example', 'test-token');

    const result = await workspaceApi.listConversations();

    expect(result).toHaveLength(101);
    expect(urls.map((url) => new URL(url).searchParams.get('offset'))).toEqual(['0', '100']);
  });

  it('stops if an older server ignores the offset and repeats a full page', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      agents: ['human:user', `openagents:agent-${index}`],
      last_message: { content: '', sender: 'human:user', timestamp: index },
      message_count: 1,
    }));
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: { conversations: firstPage } }) }));
    vi.stubGlobal('fetch', fetchMock);
    workspaceApi.configure('example', 'test-token');

    expect(await workspaceApi.listConversations()).toHaveLength(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
