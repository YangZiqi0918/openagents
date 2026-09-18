// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const layout = vi.hoisted(() => ({ viewMode: 'threads', openView: vi.fn(), openNewThread: vi.fn() }));

vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/desktop-host', () => ({ desktopHost: () => null }));
vi.mock('@/lib/helpers', () => ({ isRecentAgent: () => true, agentLabel: (agent: { agentName: string }) => agent.agentName }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/lib/workspace-context', () => ({
  useWorkspace: () => ({
    workspace: { name: 'Test Workspace' },
    agents: [{ agentName: 'agent-one', status: 'online', builtin: false }],
    sessions: [],
    dmConversations: [],
    currentSessionId: null,
    unreadSessionIds: new Set(),
    unreadNotificationCount: 0,
    onlineUsers: [{ id: 'human-one', name: 'Person' }],
    currentUser: { id: 'human-one', name: 'Person' },
    tasks: [{ status: 'need_input' }],
    setCurrentSessionId: vi.fn(),
  }),
}));
vi.mock('./layout-context', () => ({
  useLayout: () => ({
    viewMode: layout.viewMode,
    openView: layout.openView,
    openNewThread: layout.openNewThread,
    draftThreadOpen: false,
    setDraftThreadOpen: vi.fn(),
    setSelectedAgentName: vi.fn(),
    isRailExpanded: true,
    railDragWidth: null,
  }),
  RAIL_WIDTH_COLLAPSED: 52,
  RAIL_WIDTH_EXPANDED: 180,
}));
vi.mock('@/components/ui/sidebar', () => {
  const wrap = (tag: 'div' | 'ul' | 'li' = 'div') =>
    ({ children, id, className }: { children?: React.ReactNode; id?: string; className?: string }) =>
      React.createElement(tag, { id, className }, children);
  return {
    Sidebar: wrap(), SidebarContent: wrap(), SidebarFooter: wrap(), SidebarGroup: wrap(),
    SidebarGroupContent: wrap(), SidebarGroupLabel: wrap(), SidebarHeader: wrap(),
    SidebarMenu: wrap('ul'), SidebarMenuItem: wrap('li'),
    SidebarMenuButton: ({ children, asChild, onClick, isActive, ...props }: {
      children?: React.ReactNode; asChild?: boolean; onClick?: () => void;
      isActive?: boolean; 'aria-label'?: string;
    }) => asChild ? children : React.createElement('button', {
      'aria-label': props['aria-label'], 'data-active': isActive, onClick,
    }, children),
  };
});
vi.mock('@/components/ui/separator', () => ({ Separator: () => null }));
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: () => null,
}));
vi.mock('@/components/agents/agent-avatar', () => ({ AgentAvatar: () => null }));
vi.mock('./search-menu', () => ({ SearchMenu: () => null }));
vi.mock('./notifications-menu', () => ({ NotificationsMenu: () => null }));
vi.mock('./qrcode-menu', () => ({ QrcodeMenu: () => null }));
vi.mock('./user-menu', () => ({ UserMenu: () => null }));
vi.mock('@/components/campaign/campaign-sidebar-card', () => ({ CampaignSidebarCard: () => null }));

import { NavRail } from './nav-rail';

describe('desktop workspace navigation', () => {
  beforeEach(() => {
    layout.viewMode = 'threads';
    layout.openView.mockClear();
    layout.openNewThread.mockClear();
  });

  it('places New Conversation above Projects and All Conversations below agents', () => {
    const html = renderToStaticMarkup(React.createElement(NavRail));

    expect(html.indexOf('aria-label="draftThread.title"')).toBeLessThan(html.indexOf('aria-label="views.projects"'));
    expect(html).toContain('aria-label="views.projects"');
    expect(html.indexOf('nav.agentsWithCount')).toBeLessThan(html.indexOf('nav.allConversations'));
    expect(html).toContain('nav.allConversations');
    expect(html).not.toContain('/legacy-home');
    for (const mode of ['files', 'browser', 'tasks', 'workflows']) {
      expect(html).not.toContain(`aria-label="views.${mode}"`);
    }
    expect(html).toContain('aria-label="views.routines"');
    expect(html).toContain('aria-label="views.knowledge"');
    expect(html).toContain('id="rail-agent-list" class="hidden"');
    expect(html).not.toContain('nav.onlineWithCount');
    expect(html).not.toContain('Person');
  });

  it('opens Projects in the current workspace without a home-page link', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(() => root.render(React.createElement(NavRail)));
      const button = container.querySelector<HTMLButtonElement>('button[aria-label="views.projects"]');
      expect(button).not.toBeNull();
      await act(() => button!.click());
      expect(layout.openView).toHaveBeenCalledExactlyOnceWith('projects');

      layout.viewMode = 'projects';
      await act(() => root.render(React.createElement(NavRail)));
      expect(container.querySelector('button[aria-label="views.projects"]')?.getAttribute('data-active')).toBe('true');
      expect(container.querySelector('a[href*="legacy-home"]')).toBeNull();
    } finally {
      await act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('starts a draft from the top New Conversation entry', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(() => root.render(React.createElement(NavRail)));
      await act(() => container.querySelector<HTMLButtonElement>('button[aria-label="draftThread.title"]')!.click());
      expect(layout.openNewThread).toHaveBeenCalledOnce();
    } finally {
      await act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});
