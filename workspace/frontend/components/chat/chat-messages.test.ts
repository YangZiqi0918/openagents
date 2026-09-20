// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { WorkspaceMessage } from '@/lib/types';
import { ChatMessages } from './chat-messages';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 80,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 80 })),
    measureElement: () => {},
  }),
}));
vi.mock('@/components/agents/agent-avatar', () => ({
  AgentAvatar: ({ name }: { name: string }) => React.createElement('span', null, name),
}));
vi.mock('./chat-message', () => ({
  ChatMessage: ({ message }: { message: WorkspaceMessage }) => React.createElement('div', null, message.content),
}));
vi.mock('./thinking-message', () => ({
  ThinkingMessage: ({ messages }: { messages: WorkspaceMessage[] }) => React.createElement('div', null, messages.map((m) => m.content).join(' ')),
}));
vi.mock('./intermediate-steps', () => ({
  IntermediateSteps: ({ steps }: { steps: WorkspaceMessage[] }) => React.createElement('div', null, steps.map((m) => m.content).join(' ')),
}));

const message = (messageId: string, messageType: string, content = '', metadata: Record<string, unknown> = {}): WorkspaceMessage => ({
  messageId,
  sessionId: 'channel/project',
  senderType: messageType === 'loading' ? 'agent' : 'human',
  senderName: 'helper',
  content,
  mentions: [],
  targetAgents: null,
  messageType,
  metadata,
  createdAt: new Date().toISOString(),
});

let host: HTMLDivElement;
let root: Root;

async function renderMessages(messages: WorkspaceMessage[], locale: 'zh-CN' | 'en-US' = 'zh-CN', preserveThinkingHistory = false) {
  await act(async () => {
    root.render(React.createElement(I18nProvider, {
      initialLocale: locale,
      hasStoredLocale: true,
      children: React.createElement(ChatMessages, { messages, showAllSteps: false, preserveThinkingHistory }),
    }));
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('ChatMessages project pending display', () => {
  it('keeps a current project waiting row visible after an older stopped status', async () => {
    await renderMessages([
      message('old-status', 'status', 'Execution stopped'),
      message('current-request', 'chat', 'New request'),
      message('pending', 'loading', '', { projectPending: true, waitingPhase: 'active' }),
    ]);

    expect(host.textContent).toContain('New request');
    expect(host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('helper 正在工作');
    expect(host.querySelectorAll('.typing-dot')).toHaveLength(3);
    expect(host.querySelectorAll('[data-index]')).toHaveLength(2);
  });

  it('shows a localized static status after the waiting phase becomes stale', async () => {
    const request = message('request', 'chat', 'New request');
    await renderMessages([
      request,
      message('pending', 'loading', '', {
        projectPending: true,
        waitingPhase: 'stale',
        waitingStatus: '仍在等待',
      }),
    ]);
    expect(host.textContent).toContain('仍在等待');
    expect(host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('helper: 仍在等待');
    expect(host.querySelectorAll('.typing-dot')).toHaveLength(0);

    await renderMessages([
      request,
      message('pending', 'loading', '', { projectPending: true, waitingPhase: 'active' }),
    ]);
    expect(host.textContent).not.toContain('仍在等待');
    expect(host.querySelectorAll('.typing-dot')).toHaveLength(3);
  });

  it('keeps the old optimistic indicator suppressed by terminal history', async () => {
    await renderMessages([
      message('old-status', 'status', 'Execution stopped'),
      message('legacy', 'loading'),
    ]);
    expect(host.querySelector('[role="status"]')).toBeNull();

    await renderMessages([
      message('plain', 'chat', 'Ordinary thread'),
      message('legacy', 'loading'),
    ]);
    expect(host.querySelectorAll('.typing-dot')).toHaveLength(3);
  });

  it('uses the project-provided English status without changing the message row position', async () => {
    await renderMessages([
      message('plain', 'chat', 'Shared message'),
      message('pending', 'loading', '', {
        projectPending: true,
        waitingPhase: 'stale',
        waitingStatus: 'Still waiting',
      }),
    ], 'en-US');
    expect(host.querySelector('[data-index="1"] [role="status"]')?.textContent).toContain('Still waiting');
    expect(host.querySelectorAll('.typing-dot')).toHaveLength(0);
  });

  it('keeps actual project thinking after a matching final reply without changing legacy deduplication', async () => {
    const thinking = { ...message('thinking', 'thinking', 'Examining the result'), senderType: 'agent' };
    const reply = { ...message('reply', 'chat', 'Examining the result: done'), senderType: 'agent' };

    await renderMessages([thinking, reply], 'zh-CN', true);
    expect(host.textContent).toContain('Examining the resultExamining the result: done');

    await renderMessages([thinking, reply]);
    expect(host.textContent).toBe('Examining the result: done');
  });
});
