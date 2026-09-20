// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventToMessage, type ONMEvent, type WorkspaceMessage } from '@/lib/types';

const mock = vi.hoisted(() => ({
  pollEvents: vi.fn(),
  loadMessageHistory: vi.fn(),
  pollMessages: vi.fn(),
  pollConversation: vi.fn(),
}));

vi.mock('@/lib/api-config', () => ({ IS_LOCAL_AUTH: true, API_URL: 'http://local-api' }));
vi.mock('@/lib/workspace-api-context', () => ({
  useWorkspaceApi: () => mock,
}));

import { useMessagePolling } from './use-polling';

type PollingState = ReturnType<typeof useMessagePolling>;
let current: PollingState;
let container: HTMLDivElement;
let root: Root;

function event(id: number, channel: string, messageType: string = 'chat'): ONMEvent {
  return {
    id: `event-${id}`,
    type: 'workspace.message.posted',
    source: messageType === 'chat' ? 'human:alice' : 'openagents:helper',
    target: `channel/${channel}`,
    payload: { content: `text-${id}`, message_type: messageType },
    metadata: {},
    timestamp: 1_000_000 + id * 1_000,
    visibility: 'channel',
  };
}

function Screen({ channel, includeThinkingHistory = true, initialMessages }: {
  channel: string; includeThinkingHistory?: boolean; initialMessages?: WorkspaceMessage[];
}) {
  current = useMessagePolling({ sessionId: channel, includeThinkingHistory, initialMessages });
  return React.createElement('div', null, current.messages.length);
}

async function render(channel = 'project-a', includeThinkingHistory = true, initialMessages?: WorkspaceMessage[]) {
  await act(async () => root.render(React.createElement(Screen, { channel, includeThinkingHistory, initialMessages })));
}

function provideEvents(events: ONMEvent[]) {
  mock.pollEvents.mockImplementation(async ({ channel, before, limit }: {
    channel: string; before?: string; limit: number;
  }) => {
    const sorted = events.filter((row) => row.target === `channel/${channel}` &&
      !['status', 'todos'].includes(String(row.payload?.message_type))).sort((a, b) => b.timestamp - a.timestamp);
    const start = before ? sorted.findIndex((row) => row.id === before) + 1 : 0;
    const page = sorted.slice(start, start + limit);
    return {
      events: page,
      has_more: start + page.length < sorted.length,
      oldest_id: page.at(-1)?.id ?? null,
      newest_id: page[0]?.id ?? null,
    };
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mock.pollEvents.mockReset();
  mock.loadMessageHistory.mockReset();
  mock.pollMessages.mockReset().mockResolvedValue({ messages: [], hasMore: false });
  mock.pollConversation.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('project thinking history', () => {
  it('keeps the original concise channel history when the option is omitted', async () => {
    mock.loadMessageHistory.mockResolvedValue({ events: [event(1, 'project-a')], has_more: false });
    await render('project-a', false);

    expect(mock.loadMessageHistory).toHaveBeenCalledWith('project-a', { before: undefined, limit: 50 });
    expect(mock.pollEvents).not.toHaveBeenCalled();
    expect(current.messages.map((msg) => msg.messageId)).toEqual(['event-1']);
  });

  it('fills history through thinking rows up to 500 events and resumes from the actual oldest event', async () => {
    const events = Array.from({ length: 550 }, (_, i) => event(i + 1, 'project-a', i < 60 ? 'chat' : 'thinking'));
    provideEvents(events);
    await render();

    expect(current.messages).toHaveLength(500);
    expect(current.messages[0].messageId).toBe('event-51');
    expect(current.messages.at(-1)?.messageId).toBe('event-550');
    expect(current.hasOlder).toBe(true);
    expect(mock.pollEvents.mock.calls.every(([opts]) =>
      opts.channel === 'project-a' && opts.type === 'workspace.message' &&
      opts.sort === 'desc' && opts.excludeMessageTypes.join(',') === 'status,todos',
    )).toBe(true);

    await act(async () => current.loadOlder());
    expect(current.messages).toHaveLength(550);
    expect(current.messages[0].messageId).toBe('event-1');
    expect(current.hasOlder).toBe(false);
    expect(mock.pollEvents.mock.calls.at(-1)?.[0].before).toBe('event-51');
  });

  it('limits each page to 50 chat messages without losing intervening thinking events', async () => {
    const events = Array.from({ length: 120 }, (_, i) => event(i + 1, 'project-a'));
    events.push(...Array.from({ length: 80 }, (_, i) => event(i + 121, 'project-a', 'thinking')));
    provideEvents(events);
    await render();

    expect(current.messages.filter((msg) => msg.messageType === 'chat')).toHaveLength(50);
    expect(current.messages.filter((msg) => msg.messageType === 'thinking')).toHaveLength(80);
    expect(current.hasOlder).toBe(true);

    await act(async () => current.loadOlder());
    expect(current.messages.filter((msg) => msg.messageType === 'chat')).toHaveLength(100);
    await act(async () => current.loadOlder());
    expect(current.messages.map((msg) => msg.messageId)).toHaveLength(200);
    expect(current.hasOlder).toBe(false);
  });

  it('does not degrade to one request per thinking event after 49 chat messages', async () => {
    const events = Array.from({ length: 550 }, (_, i) =>
      event(i + 1, 'project-a', i >= 501 ? 'chat' : 'thinking'));
    provideEvents(events);
    await render();

    expect(current.messages).toHaveLength(500);
    expect(current.messages.filter((msg) => msg.messageType === 'chat')).toHaveLength(49);
    expect(current.hasOlder).toBe(true);
    expect(mock.pollEvents).toHaveBeenCalledTimes(5);
    await act(async () => current.loadOlder());
    expect(current.messages).toHaveLength(550);
    expect(current.hasOlder).toBe(false);
  });

  it('retains older availability after truncating a fetched batch at its 50th chat', async () => {
    const events = Array.from({ length: 80 }, (_, i) =>
      event(i + 1, 'project-a', i === 20 || i >= 31 ? 'chat' : 'thinking'));
    provideEvents(events);
    await render();

    expect(mock.pollEvents).toHaveBeenCalledTimes(1);
    expect(current.messages).toHaveLength(60);
    expect(current.messages[0].messageId).toBe('event-21');
    expect(current.hasOlder).toBe(true);

    await act(async () => current.loadOlder());
    expect(mock.pollEvents.mock.calls.at(-1)?.[0].before).toBe('event-21');
    expect(current.messages).toHaveLength(80);
    expect(current.hasOlder).toBe(false);
  });

  it('hydrates a thinking-only channel and uses its newest event for forward polling', async () => {
    const initial = [event(1, 'project-a', 'thinking'), event(2, 'project-a', 'thinking')];
    provideEvents(initial);
    mock.pollMessages.mockImplementation(async (_channel: string, after: string | undefined) => ({
      messages: after === 'event-2' && initial.length > 2
        ? [{
            messageId: 'event-3', sessionId: 'project-a', senderType: 'agent',
            senderName: 'helper', content: 'answer', mentions: [], targetAgents: null,
            messageType: 'chat', metadata: {}, createdAt: new Date(1_003_000).toISOString(),
          }]
        : [],
      hasMore: false,
    }));
    await render();
    expect(current.messages.map((msg) => msg.messageType)).toEqual(['thinking', 'thinking']);
    expect(mock.pollMessages).toHaveBeenCalledWith('project-a', 'event-2');

    initial.push(event(3, 'project-a'));
    await act(async () => current.forceRefresh());
    expect(current.messages.map((msg) => msg.messageId)).toEqual(['event-1', 'event-2', 'event-3']);
    await act(async () => current.forceRefresh());
    expect(current.messages).toHaveLength(3);
  });

  it('hydrates thinking over a cached chat and excludes historical status and todos', async () => {
    const cached = event(3, 'project-a');
    provideEvents([
      event(1, 'project-a', 'thinking'),
      event(2, 'project-a', 'status'),
      cached,
      event(4, 'project-a', 'todos'),
    ]);
    await render('project-a', true, [eventToMessage(cached)]);

    expect(current.messages.map((msg) => msg.messageId)).toEqual(['event-1', 'event-3']);
    expect(current.hasOlder).toBe(false);
    expect(mock.pollMessages).toHaveBeenCalledWith('project-a', 'event-3');
  });

  it('discards a stale history page after switching channels', async () => {
    let resolveA!: (value: unknown) => void;
    mock.pollEvents.mockImplementation(({ channel }: { channel: string }) => channel === 'project-a'
      ? new Promise((resolve) => { resolveA = resolve; })
      : Promise.resolve({ events: [event(2, 'project-b')], has_more: false }));
    await render('project-a');
    await render('project-b');
    expect(current.messages.map((msg) => msg.content)).toEqual(['text-2']);

    await act(async () => resolveA({ events: [event(1, 'project-a')], has_more: false }));
    expect(current.messages.map((msg) => msg.content)).toEqual(['text-2']);
    expect(current.loading).toBe(false);
  });

  it('discards an older page in flight when the channel changes', async () => {
    let resolveOlder!: (value: unknown) => void;
    const rows = Array.from({ length: 60 }, (_, i) => event(i + 1, 'project-a'));
    provideEvents(rows);
    const original = mock.pollEvents.getMockImplementation()!;
    mock.pollEvents.mockImplementation((opts: { channel: string; before?: string; limit: number }) => {
      if (opts.channel === 'project-b') return Promise.resolve({ events: [event(100, 'project-b')], has_more: false });
      if (opts.before === 'event-11') return new Promise((resolve) => { resolveOlder = resolve; });
      return original(opts);
    });
    await render('project-a');
    expect(current.hasOlder).toBe(true);

    let pending!: Promise<void>;
    act(() => { pending = current.loadOlder(); });
    expect(current.loadingOlder).toBe(true);
    await render('project-b');
    await act(async () => resolveOlder({ events: rows.slice(0, 10).reverse(), has_more: false }));
    await pending;

    expect(current.messages.map((msg) => msg.messageId)).toEqual(['event-100']);
    expect(current.loadingOlder).toBe(false);
  });
});
