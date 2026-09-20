// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { ChatInput, PendingFile } from '@/components/chat/chat-input';
import type { ChatMessages } from '@/components/chat/chat-messages';
import type {
  NetworkChannel,
  WorkspaceAgent,
  WorkspaceMessage,
} from '@/lib/types';
import { ProjectActivityPage } from './project-activity-page';
import { activityStorageKey } from './project-activity-model';

const mock = vi.hoisted(() => ({
  mobile: false,
  workspaceId: 'workspace',
  userId: 'user',
  localAuth: false,
  role: 'member',
  agents: [
    { agentName: 'helper', displayName: 'Helper', status: 'online' },
  ] as WorkspaceAgent[],
  channels: [] as NetworkChannel[],
  messages: {} as Record<string, WorkspaceMessage[]>,
  renderedMessages: [] as WorkspaceMessage[],
  input: null as React.ComponentProps<typeof ChatInput> | null,
  files: [] as PendingFile[],
  polling: vi.fn(),
  loadOlder: vi.fn(),
  refresh: vi.fn(),
  confirm: vi.fn(),
  personalSelection: vi.fn(),
  personalCreate: vi.fn(),
  api: {
    discover: vi.fn(),
    sendEvent: vi.fn(),
    updateChannel: vi.fn(),
    uploadFile: vi.fn(),
    sendMessage: vi.fn(),
    addChannelParticipant: vi.fn(),
    removeChannelParticipant: vi.fn(),
    fetchResource: vi.fn(),
    getTeam: vi.fn(),
    pollEvents: vi.fn(),
    getFileUrl: vi.fn(),
  },
}));

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mock.mobile }));
vi.mock('@/lib/api-config', () => ({ get IS_LOCAL_AUTH() { return mock.localAuth; } }));
vi.mock('@/lib/workspace-context', () => ({
  useWorkspace: () => ({
    workspace: { workspaceId: mock.workspaceId },
    currentUser: { id: mock.userId, name: 'User', isAuthenticated: true },
    agents: mock.agents,
    workflows: [],
    me: { role: mock.role, username: mock.userId },
    setCurrentSessionId: mock.personalSelection,
    createSession: mock.personalCreate,
  }),
}));
vi.mock('@/lib/api', () => ({ workspaceApi: mock.api }));
vi.mock('@/lib/share-origin', () => ({
  shareOrigin: () => 'https://workspace.test',
}));
vi.mock('@/components/ui/dialogs-provider', () => ({
  useConfirm: () => mock.confirm,
}));
vi.mock('@/hooks/use-composing-signal', () => ({
  useComposingSignal: () => ({
    notifyFocus: vi.fn(),
    notifyBlur: vi.fn(),
    notifyTyping: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-polling', () => ({
  useMessagePolling: (options: { sessionId: string }) => {
    mock.polling(options);
    return {
      messages: mock.messages[options.sessionId] || [],
      loading: false,
      forceRefresh: mock.refresh,
      generation: 0,
      loadOlder: mock.loadOlder,
      hasOlder: true,
      loadingOlder: false,
    };
  },
}));
vi.mock('@/components/chat/chat-input', () => ({
  ChatInput: (props: React.ComponentProps<typeof ChatInput>) => {
    mock.input = props;
    return React.createElement(
      'div',
      null,
      React.createElement('input', {
        'data-testid': 'draft',
        value: props.draft,
        disabled: props.disabled,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          props.onDraftChange?.(event.target.value),
      }),
      React.createElement(
        'button',
        {
          'data-testid': 'send',
          disabled: props.disabled,
          onClick: () => {
            props.onSend(props.draft || '', ['helper'], mock.files);
            props.onDraftChange?.('');
          },
        },
        'Send',
      ),
    );
  },
}));
vi.mock('@/components/chat/chat-messages', () => ({
  ChatMessages: (props: React.ComponentProps<typeof ChatMessages>) => {
    mock.renderedMessages = props.messages;
    return React.createElement(
      'div',
      { 'data-testid': 'messages' },
      ...props.messages.map((message) =>
        React.createElement('p', { key: message.messageId }, message.content),
      ),
      React.createElement(
        'button',
        { 'data-testid': 'history', onClick: props.loadOlder },
        'History',
      ),
    );
  },
}));

const channel = (id: string, title: string, extra = {}): NetworkChannel => ({
  address: `channel/${id}`,
  title,
  participants: [],
  master: null,
  status: 'active',
  starred: false,
  created_at: 1,
  last_event_at: 10,
  ...extra,
});
const message = (
  id: string,
  content: string,
  extra = {},
): WorkspaceMessage => ({
  messageId: `${id}-${content}`,
  sessionId: id,
  senderType: 'human',
  senderName: 'User',
  content,
  mentions: [],
  targetAgents: null,
  messageType: 'chat',
  metadata: {},
  createdAt: new Date().toISOString(),
  ...extra,
});

let root: Root;
let container: HTMLDivElement;
async function render(projectId = 'one', initialSessionId?: string) {
  await act(async () =>
    root.render(
      React.createElement(I18nProvider, {
        initialLocale: 'zh-CN',
        hasStoredLocale: true,
        children: React.createElement(ProjectActivityPage, {
          projectId,
          projectName: `Project ${projectId}`,
          initialSessionId,
        }),
      }),
    ),
  );
}
const labelled = (label: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-label]')).find(
    (element) => element.getAttribute('aria-label') === label,
  )!;
const textButton = (text: string) =>
  Array.from(
    document.querySelectorAll<HTMLElement>('button, [role="menuitem"]'),
  ).find((element) => element.textContent === text)!;
async function click(element: HTMLElement) {
  expect(element).toBeDefined();
  await act(async () => element.click());
}
async function fill(element: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function select(title = 'One') {
  const row = Array.from(
    container.querySelectorAll('[data-testid="project-activity-row"]'),
  ).find(
    (element) =>
      element.querySelector('button span span')?.textContent === title,
  );
  await click(row?.querySelector('button')!);
}
async function openMenu() {
  const trigger = container.querySelector<HTMLButtonElement>(
    '[data-testid="project-activity-row"] [data-slot="dropdown-menu-trigger"]',
  )!;
  await act(() =>
    trigger.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  mock.mobile = false;
  mock.workspaceId = 'workspace';
  mock.userId = 'user';
  mock.localAuth = false;
  mock.role = 'member';
  mock.agents = [
    { agentName: 'helper', displayName: 'Helper', status: 'online' } as WorkspaceAgent,
  ];
  mock.messages = {};
  mock.renderedMessages = [];
  mock.files = [];
  mock.channels = [
    channel('personal', 'Personal'),
    channel('project:one:a', 'One'),
    channel('project:two:a', 'Two'),
    channel('project:one-other:a', 'Similar'),
  ];
  for (const method of Object.values(mock.api)) method.mockReset();
  mock.polling.mockClear();
  mock.refresh.mockClear();
  mock.loadOlder.mockReset();
  mock.personalSelection.mockClear();
  mock.personalCreate.mockClear();
  mock.confirm.mockReset().mockResolvedValue(true);
  mock.api.discover.mockImplementation(async () => ({
    channels: mock.channels,
  }));
  mock.api.getTeam.mockResolvedValue([
    { username: 'user', role: 'member', displayName: 'User' },
    { username: 'other', role: 'member', displayName: 'Other' },
  ]);
  mock.api.pollEvents.mockResolvedValue({ events: [], has_more: false });
  mock.api.fetchResource.mockImplementation(async (_path, options) => ({
    json: async () => ({ data: { following: options?.method === 'PUT'
      ? JSON.parse(options.body).following : false } }),
  }));
  mock.api.sendEvent.mockImplementation(async (event) => {
    mock.channels.push(channel(event.payload.name, event.payload.title));
    return { metadata: { channel_name: event.payload.name } };
  });
  mock.api.updateChannel.mockImplementation(async (id, updates) => {
    mock.channels = mock.channels.map((item) =>
      item.address === `channel/${id}` ? {
        ...item, ...updates,
        ...(updates.masterAgent !== undefined && { master: updates.masterAgent }),
        ...(updates.orchestrationMode && { orchestration_mode: updates.orchestrationMode }),
      } : item,
    );
  });
  mock.api.addChannelParticipant.mockImplementation(async (id, name) => {
    mock.channels = mock.channels.map((item) =>
      item.address === `channel/${id}`
        ? { ...item, participants: [...item.participants, name] }
        : item,
    );
  });
  mock.api.removeChannelParticipant.mockImplementation(async (id, name) => {
    mock.channels = mock.channels.map((item) =>
      item.address === `channel/${id}`
        ? {
            ...item,
            participants: item.participants.filter((agent) => agent !== name),
          }
        : item,
    );
  });
  mock.api.getFileUrl.mockImplementation((id) => `/file/${id}`);
  mock.api.uploadFile.mockResolvedValue({
    id: 'file-one',
    filename: 'notes.txt',
    contentType: 'text/plain',
  });
  mock.api.sendMessage.mockImplementation(async (id, content) => ({
    id: 'sent',
    target: `channel/${id}`,
    source: 'human:user',
    timestamp: Date.now(),
    payload: { content },
    metadata: {},
  }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('project activity', () => {
  it('prefers an existing link over the latest conversation and restores each account selection', async () => {
    mock.channels = [
      channel('project:one:old', 'Old', { last_event_at: 10 }),
      channel('project:one:new', 'New', { last_event_at: 30 }),
    ];
    await render('one', 'project:one:old');
    expect(container.querySelector('[data-testid="project-activity-conversation"]')
      ?.getAttribute('data-session-id')).toBe('project:one:old');
    await select('New');
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(container.querySelector('[data-testid="project-activity-conversation"]')
      ?.getAttribute('data-session-id')).toBe('project:one:new');
    mock.userId = 'second';
    await render('one');
    expect(container.querySelector('[data-testid="project-activity-conversation"]')
      ?.getAttribute('data-session-id')).toBe('project:one:new');
    await select('Old');
    await render('one');
    expect(container.querySelector('[data-testid="project-activity-conversation"]')
      ?.getAttribute('data-session-id')).toBe('project:one:old');
  });

  it('ignores a plausible local project link not returned by the scoped discovery', async () => {
    mock.localAuth = true;
    mock.workspaceId = 'project-one';
    mock.channels = [channel('chat-allowed', 'Allowed')];
    await render('project-one', 'chat-another-project');
    expect(container.querySelector('[data-testid="project-activity-conversation"]')
      ?.getAttribute('data-session-id')).toBe('chat-allowed');
    expect(mock.polling).not.toHaveBeenCalledWith({ sessionId: 'chat-another-project' });
  });

  it('preselects the sole ordinary online project agent, but not Yumi', async () => {
    await render();
    await click(labelled('新建会话'));
    expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')?.checked).toBe(true);
    await fill(document.querySelector<HTMLInputElement>('#activity-conversation-name')!, 'Agent discussion');
    await click(textButton('创建'));
    expect(mock.api.sendEvent).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ participants: ['helper'] }),
    }));

    mock.agents = [{ agentName: 'yumi', displayName: 'Yumi', status: 'online', builtin: true } as WorkspaceAgent];
    await render();
    await click(labelled('新建会话'));
    expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')?.checked).toBe(false);
    await fill(document.querySelector<HTMLInputElement>('#activity-conversation-name')!, 'Human discussion');
    await click(textButton('创建'));
    expect(mock.api.sendEvent).toHaveBeenLastCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ participants: [] }),
    }));
  });

  it('leaves multiple agents unselected and never carries another project selection across a switch', async () => {
    mock.agents = [
      { agentName: 'helper', displayName: 'Helper', status: 'online' } as WorkspaceAgent,
      { agentName: 'second', displayName: 'Second', status: 'online' } as WorkspaceAgent,
      { agentName: 'offline', displayName: 'Offline', status: 'offline' } as WorkspaceAgent,
    ];
    await render();
    await click(labelled('新建会话'));
    expect(Array.from(document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]'))
      .map((input) => input.checked)).toEqual([false, false]);
    await click(document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')[1]);
    mock.workspaceId = 'two';
    mock.agents = [{ agentName: 'other-project', displayName: 'Other project', status: 'online' } as WorkspaceAgent];
    await render('two');
    await click(labelled('新建会话'));
    await fill(document.querySelector<HTMLInputElement>('#activity-conversation-name')!, 'Other project chat');
    await click(textButton('创建'));
    expect(mock.api.sendEvent).toHaveBeenCalledOnce();
    expect(mock.api.sendEvent).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ participants: ['other-project'] }),
    }));
  });

  it('sends only explicitly chosen agents when multiple are online', async () => {
    mock.agents = [
      { agentName: 'helper', displayName: 'Helper', status: 'online' } as WorkspaceAgent,
      { agentName: 'second', displayName: 'Second', status: 'online' } as WorkspaceAgent,
    ];
    await render();
    await click(labelled('新建会话'));
    await click(document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')[1]);
    await fill(document.querySelector<HTMLInputElement>('#activity-conversation-name')!, 'Second agent');
    await click(textButton('创建'));
    expect(mock.api.sendEvent).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ participants: ['second'] }),
    }));
  });

  it('uses project-scoped subscription and mentions only current project human members', async () => {
    mock.localAuth = true;
    mock.workspaceId = 'project-one';
    mock.channels = [channel('chat-one', 'Shared')];
    await render('project-one');
    expect(container.querySelector('[data-testid="project-activity-conversation"]')
      ?.getAttribute('data-session-id')).toBe('chat-one');
    expect(mock.api.fetchResource).toHaveBeenCalledWith(
      '/v1/workspaces/project-one/channels/chat-one/subscription',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await click(labelled('关注会话'));
    expect(mock.api.fetchResource).toHaveBeenLastCalledWith(
      '/v1/workspaces/project-one/channels/chat-one/subscription',
      { method: 'PUT', body: JSON.stringify({ following: true }) },
    );
    await click(labelled('提及项目成员'));
    expect(mock.input?.mentionTriggerKey).toBe(1);
    expect(mock.input?.projectMentions?.members?.map((member) => member.username)).toEqual(['other']);
    await act(async () => mock.input?.onSend('@{other} ', [], [], { selectedAgentNames: [] }));
    expect(mock.api.sendMessage).toHaveBeenCalledWith(
      'chat-one', '@{other} ', 'User', undefined, undefined, 'user',
    );
    expect(mock.api.fetchResource).toHaveBeenLastCalledWith(
      '/v1/workspaces/project-one/channels/chat-one/subscription',
      expect.objectContaining({}),
    );
  });

  it('passes special project usernames to the unified mention picker', async () => {
    mock.localAuth = true;
    mock.workspaceId = 'project-one';
    mock.channels = [channel('chat-one', 'Shared')];
    mock.api.getTeam.mockResolvedValue([
      { username: 'A} B\\C', role: 'member', displayName: 'Special' },
    ]);
    await render('project-one');
    await click(labelled('提及项目成员'));
    expect(mock.input?.projectMentions?.members?.map((member) => member.username)).toEqual(['A} B\\C']);
  });

  it('joins a menu-selected project agent before sending to the shared channel', async () => {
    mock.localAuth = true;
    mock.workspaceId = 'project-one';
    mock.channels = [channel('chat-one', 'Shared')];
    mock.agents = [
      { agentName: 'helper', status: 'online' } as WorkspaceAgent,
      { agentName: 'yumi', status: 'online', builtin: true } as WorkspaceAgent,
    ];
    await render('project-one');
    expect(mock.input?.agents).toEqual([]);
    expect(mock.input?.projectMentions?.agents.map((agent) => agent.agentName)).toEqual(['helper', 'yumi']);
    await act(async () => {
      mock.input?.onSend('@yumi please help', ['yumi'], [], { selectedAgentNames: ['yumi'] });
    });
    expect(mock.api.addChannelParticipant).toHaveBeenCalledWith('chat-one', 'yumi');
    expect(mock.api.sendMessage).toHaveBeenCalledWith(
      'chat-one', '@yumi please help', 'User', ['yumi'], undefined, 'user',
    );
    expect(mock.api.addChannelParticipant.mock.invocationCallOrder[0])
      .toBeLessThan(mock.api.sendMessage.mock.invocationCallOrder[0]);
  });

  it('does not send when joining fails and retries partially joined agents without losing the draft', async () => {
    mock.localAuth = true;
    mock.workspaceId = 'project-one';
    mock.channels = [channel('chat-one', 'Shared')];
    mock.agents = [
      { agentName: 'helper', status: 'online' } as WorkspaceAgent,
      { agentName: 'second', status: 'online' } as WorkspaceAgent,
    ];
    await render('project-one');
    await fill(container.querySelector<HTMLInputElement>('[data-testid="draft"]')!, '@helper @second please help');
    mock.api.addChannelParticipant.mockImplementationOnce(async (id, name) => {
      mock.channels = mock.channels.map((item) => item.address === `channel/${id}`
        ? { ...item, participants: [...item.participants, name] } : item);
    }).mockRejectedValueOnce(new Error('Join denied'));
    await act(async () => {
      mock.input?.onSend('@helper @second please help', ['helper', 'second'], [], {
        selectedAgentNames: ['helper', 'second'],
      });
    });
    expect(mock.api.sendMessage).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Join denied');
    expect(container.querySelector<HTMLInputElement>('[data-testid="draft"]')?.value)
      .toBe('@helper @second please help');
    await click(labelled('重新发送'));
    expect(mock.api.addChannelParticipant).toHaveBeenCalledWith('chat-one', 'helper');
    expect(mock.api.addChannelParticipant).toHaveBeenCalledWith('chat-one', 'second');
    expect(mock.api.addChannelParticipant.mock.calls.filter(([, name]) => name === 'helper')).toHaveLength(1);
    expect(mock.api.sendMessage).toHaveBeenCalledOnce();
  });

  it('explains an unjoined handwritten agent mention while preserving the draft', async () => {
    mock.localAuth = true;
    mock.workspaceId = 'project-one';
    mock.channels = [channel('chat-one', 'Shared')];
    mock.api.sendMessage.mockRejectedValueOnce(new Error('API 400: project_mention_agent_not_joined: helper'));
    await render('project-one');
    await fill(container.querySelector<HTMLInputElement>('[data-testid="draft"]')!, '@helper please help');
    await click(container.querySelector<HTMLButtonElement>('[data-testid="send"]')!);
    expect(container.textContent).toContain('请从 @ 菜单重新选择后发送');
    expect(container.textContent).not.toContain('project_mention_agent_not_joined');
    expect(container.querySelector<HTMLInputElement>('[data-testid="draft"]')?.value).toBe('@helper please help');
  });

  it('uses the current workflow step for project agent mentions', async () => {
    mock.localAuth = true;
    mock.workspaceId = 'project-one';
    mock.channels = [channel('chat-one', 'Workflow chat', {
      orchestration_mode: 'workflow', participants: ['helper', 'second'],
    })];
    mock.agents = [
      { agentName: 'helper', status: 'online' } as WorkspaceAgent,
      { agentName: 'second', status: 'online' } as WorkspaceAgent,
    ];
    mock.api.fetchResource.mockImplementation(async (path) => ({
      json: async () => ({ data: path.endsWith('/subscription')
        ? { following: false }
        : { workflowRunning: true, activeWorkflowStepAgent: 'second' } }),
    }));
    await render('project-one');
    expect(mock.api.fetchResource).toHaveBeenCalledWith(
      '/v1/workspaces/project-one/channels/chat-one',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mock.input?.projectMentions?.workflowRunning).toBe(true);
    expect(mock.input?.projectMentions?.activeWorkflowStepAgent).toBe('second');
  });

  it('lets members configure project agents but hides writes from viewers', async () => {
    mock.channels = [channel('project:one:a', 'One', { participants: ['helper'] })];
    await render();
    await click(labelled('负责人'));
    await click(textButton('Helper'));
    expect(mock.api.updateChannel).toHaveBeenLastCalledWith('project:one:a', { masterAgent: 'helper' });
    await click(labelled('参与 Agent'));
    await click(document.querySelector<HTMLInputElement>('[data-slot="popover-content"] input')!);
    expect(mock.api.updateChannel).toHaveBeenLastCalledWith('project:one:a', { masterAgent: '' });
    expect(mock.api.removeChannelParticipant).toHaveBeenCalledWith('project:one:a', 'helper');
    mock.role = 'viewer';
    mock.localAuth = true;
    mock.workspaceId = 'one';
    mock.channels = [channel('chat-one', 'One', { participants: ['helper'] })];
    await render();
    expect(labelled('负责人')).toBeUndefined();
    expect(labelled('新建会话')?.disabled).toBe(true);
    await click(labelled('参与 Agent'));
    expect(document.querySelector<HTMLInputElement>('[data-slot="popover-content"] input')?.disabled).toBe(true);
  });

  it('renders only this project, without creating a channel or touching personal selection', async () => {
    await render();
    expect(
      container.querySelectorAll('[data-testid="project-activity-row"]'),
    ).toHaveLength(1);
    expect(container.textContent).not.toContain('Personal');
    expect(container.textContent).not.toContain('Two');
    expect(
      container.querySelector('[data-testid="project-activity-list"]')
        ?.className,
    ).toContain('lg:w-[320px]');
    expect(mock.api.sendEvent).not.toHaveBeenCalled();
    await select();
    expect(mock.polling).toHaveBeenLastCalledWith({
      sessionId: 'project:one:a', includeThinkingHistory: true,
    });
    expect(mock.personalSelection).not.toHaveBeenCalled();
    expect(mock.personalCreate).not.toHaveBeenCalled();
  });

  it('supports human-only creation and preserves a failed creation form for retry', async () => {
    await render();
    await click(labelled('新建会话'));
    await click(document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!);
    await fill(
      document.querySelector<HTMLInputElement>('#activity-conversation-name')!,
      'Discussion',
    );
    mock.api.sendEvent.mockRejectedValueOnce(new Error('Access denied'));
    await click(textButton('创建'));
    expect(
      document.querySelector<HTMLInputElement>('#activity-conversation-name')
        ?.value,
    ).toBe('Discussion');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Access denied',
    );
    await click(textButton('创建'));
    expect(mock.api.sendEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          title: 'Discussion',
          participants: [],
          name: expect.stringMatching(/^project:one:/),
        }),
      }),
    );
    expect(
      container.querySelectorAll('[data-testid="project-activity-row"]'),
    ).toHaveLength(2);
    expect(
      container.querySelector('[data-testid="project-activity-conversation"]'),
    ).not.toBeNull();
  });

  it('renames and confirms deletion, preserving a session after a failed delete', async () => {
    await render();
    await openMenu();
    await click(textButton('重命名会话'));
    await fill(
      document.querySelector<HTMLInputElement>('#activity-conversation-name')!,
      'Renamed',
    );
    await click(textButton('保存'));
    expect(mock.api.updateChannel).toHaveBeenCalledWith('project:one:a', {
      title: 'Renamed',
    });
    await openMenu();
    mock.api.updateChannel.mockRejectedValueOnce(new Error('Delete denied'));
    await click(textButton('删除会话'));
    expect(mock.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ destructive: true }),
    );
    expect(
      container.querySelectorAll('[data-testid="project-activity-row"]'),
    ).toHaveLength(1);
    await openMenu();
    await click(textButton('删除会话'));
    expect(
      container.querySelectorAll('[data-testid="project-activity-row"]'),
    ).toHaveLength(0);
  });

  it('stores drafts and selection independently across projects, workspaces and users', async () => {
    await render();
    await select();
    await fill(
      container.querySelector<HTMLInputElement>('[data-testid="draft"]')!,
      'One draft',
    );
    await render('two');
    await select('Two');
    expect(
      container.querySelector<HTMLInputElement>('[data-testid="draft"]')?.value,
    ).toBe('');
    await fill(
      container.querySelector<HTMLInputElement>('[data-testid="draft"]')!,
      'Two draft',
    );
    await render('one');
    expect(
      container.querySelector<HTMLInputElement>('[data-testid="draft"]')?.value,
    ).toBe('One draft');
    mock.workspaceId = 'other';
    await render();
    await select();
    expect(
      container.querySelector<HTMLInputElement>('[data-testid="draft"]')?.value,
    ).toBe('');
    mock.workspaceId = 'workspace';
    mock.userId = 'other-user';
    await render();
    await select();
    expect(
      container.querySelector<HTMLInputElement>('[data-testid="draft"]')?.value,
    ).toBe('');
    expect(
      JSON.parse(
        localStorage.getItem(activityStorageKey('workspace', 'one', 'user'))!,
      ).readAt['project:one:a'],
    ).toBeGreaterThan(0);
  });

  it('scopes messages and history to the current conversation and persists new read markers', async () => {
    mock.messages['project:one:a'] = [
      message('project:one:a', 'Shared message'),
      message('personal', 'Foreign message'),
    ];
    await render('one', 'project:one:a');
    expect(container.textContent).toContain('Shared message');
    expect(container.textContent).not.toContain('Foreign message');
    await click(
      container.querySelector<HTMLButtonElement>('[data-testid="history"]')!,
    );
    expect(mock.loadOlder).toHaveBeenCalledOnce();
    expect(
      JSON.parse(
        localStorage.getItem(activityStorageKey('workspace', 'one', 'user'))!,
      ).readAt['project:one:a'],
    ).toBeGreaterThan(0);
  });

  it('shares the waiting row and real thinking between accounts without showing placeholder thinking', async () => {
    mock.localAuth = true;
    mock.workspaceId = 'project-one';
    mock.channels = [channel('chat-one', 'Shared', { participants: ['helper'] })];
    const timestamp = new Date(Date.now() - 10_000).toISOString();
    mock.messages['chat-one'] = [
      message('chat-one', 'Please help', { messageId: 'trigger', targetAgents: ['helper'], createdAt: timestamp }),
      message('chat-one', 'thinking...', { messageId: 'placeholder', senderType: 'agent', senderName: 'helper', messageType: 'thinking' }),
      message('chat-one', 'Checking the work', { messageId: 'thinking', senderType: 'agent', senderName: 'helper', messageType: 'thinking' }),
    ];
    await render('project-one');
    expect(mock.renderedMessages.map((item) => item.messageId)).toContain('thinking');
    expect(mock.renderedMessages.map((item) => item.messageId)).not.toContain('placeholder');
    expect(mock.renderedMessages.filter((item) => item.metadata.projectPending)).toEqual([
      expect.objectContaining({ senderName: 'helper', messageType: 'loading', metadata: expect.objectContaining({ waitingPhase: 'active' }) }),
    ]);

    mock.userId = 'another-member';
    await render('project-one');
    expect(mock.renderedMessages.filter((item) => item.metadata.projectPending)).toHaveLength(1);
    mock.messages['chat-one'] = [...mock.messages['chat-one'], message('chat-one', 'Finished', {
      messageId: 'reply', senderType: 'agent', senderName: 'helper', messageType: 'chat',
    })];
    await render('project-one');
    expect(mock.renderedMessages.filter((item) => item.metadata.projectPending)).toHaveLength(0);
  });

  it('checks a stopped turn without showing historical status, then waits for a newer request', async () => {
    mock.localAuth = true;
    mock.workspaceId = 'project-one';
    mock.channels = [channel('chat-one', 'Shared', { participants: ['helper'] })];
    const timestamp = Date.now() - 10_000;
    mock.messages['chat-one'] = [message('chat-one', 'Earlier request', {
      messageId: 'old-request', targetAgents: ['helper'], createdAt: new Date(timestamp).toISOString(),
    })];
    mock.api.pollEvents.mockImplementation(async ({ after }: { after: string }) => ({
      events: after === 'old-request' ? [{
        id: 'old-stop', type: 'workspace.message.posted', source: 'openagents:helper',
        target: 'channel/chat-one', payload: { message_type: 'status', content: 'Execution stopped by user' },
        metadata: {}, timestamp: timestamp + 1_000, visibility: 'channel',
      }] : [],
      has_more: false,
    }));
    await render('project-one');
    expect(mock.api.pollEvents).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'chat-one', after: 'old-request', excludeMessageTypes: ['chat', 'thinking', 'todos'],
    }));
    expect(mock.renderedMessages.map((item) => item.messageId)).not.toContain('old-stop');
    expect(mock.renderedMessages.filter((item) => item.metadata.projectPending)).toHaveLength(0);

    mock.messages['chat-one'] = [...mock.messages['chat-one'], message('chat-one', 'New request', {
      messageId: 'new-request', targetAgents: ['helper'], createdAt: new Date(timestamp + 2_000).toISOString(),
    })];
    await render('project-one');
    expect(mock.renderedMessages.filter((item) => item.metadata.projectPending)).toEqual([
      expect.objectContaining({ messageId: 'project-loading-new-request' }),
    ]);
  });

  it('finds a terminal status beyond the first status-event page', async () => {
    mock.localAuth = true;
    mock.workspaceId = 'project-one';
    mock.channels = [channel('chat-one', 'Shared', { participants: ['helper'] })];
    const timestamp = Date.now() - 10_000;
    mock.messages['chat-one'] = [message('chat-one', 'Request', {
      messageId: 'request', targetAgents: ['helper'], createdAt: new Date(timestamp).toISOString(),
    })];
    mock.api.pollEvents.mockImplementation(async ({ before }: { before?: string }) => before
      ? { events: [{
        id: 'stop', type: 'workspace.message.posted', source: 'openagents:helper',
        target: 'channel/chat-one', payload: { message_type: 'status', content: 'Execution stopped' },
        metadata: {}, timestamp: timestamp + 1_000, visibility: 'channel',
      }], has_more: false }
      : { events: [{
        id: 'other-status', type: 'workspace.message.posted', source: 'openagents:another',
        target: 'channel/chat-one', payload: { message_type: 'status', content: 'Still working' },
        metadata: {}, timestamp: timestamp + 2_000, visibility: 'channel',
      }], has_more: true });
    await render('project-one');
    expect(mock.api.pollEvents).toHaveBeenCalledTimes(2);
    expect(mock.api.pollEvents).toHaveBeenLastCalledWith(expect.objectContaining({
      channel: 'chat-one', after: 'request', before: 'other-status',
    }));
    expect(mock.renderedMessages.filter((item) => item.metadata.projectPending)).toHaveLength(0);
  });

  it('preserves failed text and attachments, retrying without duplicate uploads', async () => {
    await render();
    await select();
    await fill(
      container.querySelector<HTMLInputElement>('[data-testid="draft"]')!,
      'Hello @helper',
    );
    mock.files = [
      { file: new File(['notes'], 'notes.txt', { type: 'text/plain' }) },
    ];
    mock.api.sendMessage.mockRejectedValueOnce(
      new Error('Network unavailable'),
    );
    await click(
      container.querySelector<HTMLButtonElement>('[data-testid="send"]')!,
    );
    expect(
      container.querySelector<HTMLInputElement>('[data-testid="draft"]')?.value,
    ).toBe('Hello @helper');
    expect(container.textContent).toContain('notes.txt');
    expect(mock.api.uploadFile).toHaveBeenCalledWith(
      mock.files[0].file,
      'project:one:a',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await click(labelled('重新发送'));
    expect(mock.api.uploadFile).toHaveBeenCalledOnce();
    expect(mock.api.sendMessage).toHaveBeenLastCalledWith(
      'project:one:a',
      'Hello @helper',
      'User',
      ['helper'],
      [expect.objectContaining({ fileId: 'file-one' })],
      'user',
    );
    expect(
      container.querySelector<HTMLInputElement>('[data-testid="draft"]')?.value,
    ).toBe('');
    expect(labelled('重新发送')).toBeUndefined();
  });

  it('adds and removes agents without modifying global session state', async () => {
    await render();
    await select();
    await click(labelled('参与 Agent'));
    await click(
      document.querySelector<HTMLInputElement>(
        '[data-slot="popover-content"] input',
      )!,
    );
    expect(mock.api.addChannelParticipant).toHaveBeenCalledWith(
      'project:one:a',
      'helper',
    );
    expect(
      document.querySelector<HTMLInputElement>(
        '[data-slot="popover-content"] input',
      )?.checked,
    ).toBe(true);
    await click(
      document.querySelector<HTMLInputElement>(
        '[data-slot="popover-content"] input',
      )!,
    );
    expect(mock.api.removeChannelParticipant).toHaveBeenCalledWith(
      'project:one:a',
      'helper',
    );
    expect(mock.personalSelection).not.toHaveBeenCalled();
  });

  it('uses local mobile pane navigation and supports shared links in a second user session', async () => {
    mock.mobile = true;
    await render();
    expect(
      container.querySelector('[data-testid="project-activity-detail"]'),
    ).toBeNull();
    await select();
    expect(
      container.querySelector('[data-testid="project-activity-list"]'),
    ).toBeNull();
    await click(labelled('返回会话列表'));
    expect(
      container.querySelector('[data-testid="project-activity-list"]'),
    ).not.toBeNull();
    mock.userId = 'second-user';
    await render('one', 'project:one:a');
    expect(
      container
        .querySelector('[data-testid="project-activity-conversation"]')
        ?.getAttribute('data-session-id'),
    ).toBe('project:one:a');
    await click(labelled('复制项目链接'));
    const link = new URL(
      document.querySelector<HTMLInputElement>('[role="dialog"] input')!.value,
    );
    expect(link.searchParams.get('projectId')).toBe('one');
    expect(link.searchParams.get('projectSessionId')).toBe('project:one:a');
    expect(link.searchParams.get('token')).toBeNull();
  });

  it('ignores late discovery results after changing projects and reports storage failures', async () => {
    let resolve!: (value: unknown) => void;
    mock.api.discover.mockReturnValueOnce(
      new Promise((yes) => {
        resolve = yes;
      }),
    );
    await render('one');
    await render('two');
    await act(async () =>
      resolve({ channels: [channel('project:one:late', 'Late')] }),
    );
    expect(container.textContent).not.toContain('Late');
    expect(container.textContent).toContain('Two');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage full');
    });
    await select('Two');
    expect(container.textContent).toContain('无法保存本地草稿');
  });

  it('recovers from discovery permission errors without creating a channel', async () => {
    mock.api.discover.mockRejectedValueOnce(new Error('Access denied'));
    await render();
    expect(container.textContent).toContain('无法加载项目会话');
    expect(
      container.querySelectorAll('[data-testid="project-activity-row"]'),
    ).toHaveLength(0);
    await click(labelled('重试'));
    expect(
      container.querySelectorAll('[data-testid="project-activity-row"]'),
    ).toHaveLength(1);
    expect(mock.api.sendEvent).not.toHaveBeenCalled();
  });

  it('does not restore a foreign session from a link', async () => {
    await render('one', 'project:two:a');
    expect(
      container.querySelector('[data-testid="project-activity-conversation"]')
        ?.getAttribute('data-session-id'),
    ).toBe('project:one:a');
    expect(mock.polling).not.toHaveBeenCalledWith({ sessionId: 'project:two:a' });
  });

  it('ignores a late send response after changing projects and preserves the original draft', async () => {
    let resolve!: (value: unknown) => void;
    mock.api.sendMessage.mockReturnValueOnce(
      new Promise((yes) => {
        resolve = yes;
      }),
    );
    await render();
    await select();
    await fill(
      container.querySelector<HTMLInputElement>('[data-testid="draft"]')!,
      'Pending one',
    );
    await click(
      container.querySelector<HTMLButtonElement>('[data-testid="send"]')!,
    );
    await render('two');
    await select('Two');
    await fill(
      container.querySelector<HTMLInputElement>('[data-testid="draft"]')!,
      'Draft two',
    );
    await act(async () =>
      resolve({
        id: 'late-send',
        target: 'channel/project:one:a',
        source: 'human:user',
        timestamp: Date.now(),
        payload: { content: 'Pending one' },
      }),
    );
    expect(
      container.querySelector<HTMLInputElement>('[data-testid="draft"]')?.value,
    ).toBe('Draft two');
    expect(container.textContent).not.toContain('Pending one');
    expect(
      JSON.parse(
        localStorage.getItem(activityStorageKey('workspace', 'one', 'user'))!,
      ).drafts['project:one:a'],
    ).toBe('Pending one');
  });

  it('refreshes every 5 seconds and stops refreshing when unmounted', async () => {
    vi.useFakeTimers();
    await render();
    const calls = mock.api.discover.mock.calls.length;
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(mock.api.discover).toHaveBeenCalledTimes(calls + 1);
    await act(async () => root.unmount());
    const afterUnmount = mock.api.discover.mock.calls.length;
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(mock.api.discover).toHaveBeenCalledTimes(afterUnmount);
  });
});
