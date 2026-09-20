// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { TeamMember, WorkspaceAgent } from '@/lib/types';
import { ChatInput, type PendingFile, type ProjectMentionConfig, type SelectedMentionMetadata } from './chat-input';

vi.mock('@/components/agents/agent-avatar', () => ({
  AgentAvatar: ({ name }: { name: string }) => React.createElement('span', null, name),
}));

const agent = (name: string, displayName = name, status = 'online'): WorkspaceAgent => ({
  agentName: name, displayName, status, role: 'member', agentType: null, serverHost: null,
  workingDir: null, description: null, enabledSkills: null, model: null,
  lastHeartbeatAt: null, joinedAt: null,
});
const member = (username: string, displayName = username): TeamMember => ({
  email: `${username}@test.local`, username, displayName, avatarUrl: null,
  role: 'member', joinedAt: null,
});
const config = (overrides: Partial<ProjectMentionConfig> = {}): ProjectMentionConfig => ({
  agents: [agent('helper')], participantNames: [], members: [], membersError: false,
  onRetryMembers: vi.fn(), ...overrides,
});

type InputProps = React.ComponentProps<typeof ChatInput>;
let host: HTMLDivElement;
let root: Root;
const onSend = vi.fn<(content: string, mentions: string[], files: PendingFile[], metadata?: SelectedMentionMetadata) => void>();

async function renderInput(props: Partial<InputProps> = {}) {
  await act(async () => {
    root.render(React.createElement(I18nProvider, {
      initialLocale: 'zh-CN', hasStoredLocale: true,
      children: React.createElement(ChatInput, { onSend, ...props }),
    }));
  });
  return host.querySelector('textarea')!;
}

async function enter(value: string, cursor = value.length) {
  const textarea = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
    textarea.setSelectionRange(cursor, cursor);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return textarea;
}

async function key(name: string, options: KeyboardEventInit = {}) {
  await act(async () => {
    host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', {
      key: name, bubbles: true, cancelable: true, ...options,
    }));
  });
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  onSend.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('project @ picker in the real ChatInput', () => {
  it('suggests a single current-project agent, including one not joined, and passes explicit selection metadata', async () => {
    const textarea = await renderInput({ projectMentions: config() });
    await enter('@he');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(host.textContent).toContain('加入会话后参与');
    await key('Enter');
    expect(textarea.value).toBe('@helper');
    await click(host.querySelector('[aria-label="发送消息"]')!);
    expect(onSend).toHaveBeenCalledWith('@helper', [], [], { selectedAgentNames: ['helper'] });
  });

  it('keeps human and agent identities distinct even with the same name', async () => {
    const textarea = await renderInput({ projectMentions: config({ agents: [agent('alice', 'Alice')], members: [member('alice', 'Alice')] }) });
    await enter('@al');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(2);
    await click(host.querySelectorAll('[role="option"]')[1]);
    expect(textarea.value).toBe('@{alice}');
    await key('Enter');
    expect(onSend).toHaveBeenCalledWith('@{alice}', [], [], { selectedAgentNames: [] });
  });

  it('replaces the full mention at the caret without deleting following text', async () => {
    const textarea = await renderInput({ projectMentions: config() });
    const text = 'Before @helper after';
    await enter(text, text.indexOf('@') + 4);
    await key('Tab');
    expect(textarea.value).toBe(text);
    await key('Enter');
    expect(onSend.mock.lastCall?.[3]).toEqual({ selectedAgentNames: ['helper'] });
  });

  it('searches Unicode and spaces, then escapes human usernames for the backend', async () => {
    const textarea = await renderInput({ projectMentions: config({ agents: [], members: [member('张 三}Q\\x', '张 三 名称')] }) });
    await enter('@张 三');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
    await click(host.querySelector('[role="option"]')!);
    expect(textarea.value).toBe('@{张 三\\}Q\\\\x}');
    await key('Enter');
    expect(onSend.mock.lastCall?.[3]).toEqual({ selectedAgentNames: [] });
  });

  it('prioritizes joined agents, filters offline ones, and limits running workflows to the active step', async () => {
    await renderInput({ projectMentions: config({
      agents: [agent('new'), agent('busy'), agent('offline', 'offline', 'offline')],
      participantNames: ['busy'],
      workflowRunning: true, activeWorkflowStepAgent: 'busy',
    }) });
    await enter('@');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(host.textContent).toContain('当前步骤智能体');
    expect(host.querySelector('[role="option"]')!.textContent).toContain('busy');
  });

  it('sorts joined agents first without implicitly selecting or joining Yumi', async () => {
    await renderInput({ projectMentions: config({
      agents: [agent('new'), { ...agent('Yumi'), builtin: true }, agent('joined'), agent('offline', 'Offline', 'offline')],
      participantNames: ['joined'], members: [member('new', 'new')],
    }) });
    await enter('@');
    const labels = Array.from(host.querySelectorAll('[role="option"]')).map((option) => option.textContent ?? '');
    expect(labels[0]).toContain('joined');
    expect(labels[1]).toContain('new');
    expect(labels[2]).toContain('Yumi');
    expect(labels[3]).toContain('@new');
    expect(labels.join(' ')).not.toContain('offline');
  });

  it('invalidates a selected agent when edited or externally restored, but preserves a controlled echo', async () => {
    const projectMentions = config();
    const textarea = await renderInput({ projectMentions, draft: '' });
    await enter('@he');
    await key('Enter');
    await renderInput({ projectMentions, draft: '@helper' });
    await key('Enter');
    expect(onSend.mock.lastCall?.[3]).toEqual({ selectedAgentNames: ['helper'] });

    await renderInput({ projectMentions, draft: '' });
    await enter('@he');
    await key('Enter');
    await enter('@helxper');
    await key('Enter');
    expect(onSend.mock.lastCall?.[3]).toEqual({ selectedAgentNames: [] });

    await renderInput({ projectMentions, draft: '@helper' });
    expect(textarea.value).toBe('@helper');
    await key('Enter');
    expect(onSend.mock.lastCall?.[3]).toEqual({ selectedAgentNames: [] });
  });

  it('opens from the toolbar, retries member loading, and suppresses IME Enter selection', async () => {
    const onRetryMembers = vi.fn();
    const projectMentions = config({ members: null, membersError: true, onRetryMembers });
    const textarea = await renderInput({ projectMentions, mentionTriggerKey: 0 });
    await renderInput({ projectMentions, mentionTriggerKey: 1 });
    expect(textarea.value).toBe('@');
    await click(host.querySelector('button.text-destructive')!);
    expect(onRetryMembers).toHaveBeenCalledTimes(1);
    await act(async () => textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    await enter('@he');
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    await key('Enter');
    expect(onSend).not.toHaveBeenCalled();
    await act(async () => textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
  });

  it('retains legacy behavior when project configuration is absent', async () => {
    await renderInput({ agents: [agent('single')] });
    await enter('@');
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    await key('Enter');
    expect(onSend).toHaveBeenCalledWith('@', [], []);
  });
});
