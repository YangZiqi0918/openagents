// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { LayoutProvider, useLayout } from '@/components/layout/layout-context';
import { ProjectInternalPage } from './project-internal-page';

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mobile.value }));
const role = vi.hoisted(() => ({ value: 'admin' }));
vi.mock('@/lib/workspace-context', () => ({
  useWorkspace: () => ({ workspace: { workspaceId: 'test' }, agents: [], me: { role: role.value } }),
  useOptionalWorkspace: () => ({ workspace: { workspaceId: 'test' }, agents: [], me: { role: role.value } }),
}));
vi.mock('@/lib/api', () => ({ workspaceApi: { getTeam: vi.fn().mockResolvedValue([]) } }));
vi.mock('./project-activity-page', () => ({ ProjectActivityPage: () => React.createElement('div', { 'data-testid': 'activity-module' }) }));
vi.mock('@/components/tasks/tasks-view', () => ({ TasksView: () => React.createElement('div', { 'data-testid': 'tasks-module' }) }));
vi.mock('@/components/workflows/workflows-view', () => ({ WorkflowsView: () => React.createElement('div', { 'data-testid': 'workflows-module' }) }));
vi.mock('@/components/files/file-list', () => ({ FileList: () => React.createElement(MockList, { name: 'files' }) }));
vi.mock('@/components/files/file-preview', () => ({ FilePreview: () => React.createElement(MockDetail, { name: 'files' }) }));
vi.mock('@/components/files/trash-view', () => ({ TrashView: () => React.createElement(MockDetail, { name: 'trash' }) }));
vi.mock('@/components/browser/browser-tab-list', () => ({ BrowserTabList: () => React.createElement(MockList, { name: 'browser' }) }));
vi.mock('@/components/browser/browser-view', () => ({ BrowserView: () => React.createElement(MockDetail, { name: 'browser' }) }));
vi.mock('@/components/knowledge/knowledge-list', () => ({ KnowledgeList: () => React.createElement(MockList, { name: 'knowledge' }) }));
vi.mock('@/components/knowledge/knowledge-view', () => ({ KnowledgeView: () => React.createElement(MockDetail, { name: 'knowledge' }) }));

function MockList({ name }: { name: string }) {
  const { openMobileDetail } = useLayout();
  return React.createElement('button', { type: 'button', 'data-testid': `${name}-list`, onClick: openMobileDetail }, '选择条目');
}

function MockDetail({ name }: { name: string }) {
  const { openMobileList } = useLayout();
  return React.createElement('button', { type: 'button', 'data-testid': `${name}-detail`, onClick: openMobileList }, '返回列表');
}

let root: Root;
let container: HTMLDivElement;

async function render(withWorkspace = true, onBack = vi.fn(), initialTab?: 'plan') {
  const page = React.createElement(ProjectInternalPage, { projectId: 'project-1', projectName: '测试项目', onBack, workspaceModulesAvailable: withWorkspace, initialTab });
  await act(() => root.render(React.createElement(I18nProvider, {
    initialLocale: 'zh-CN', hasStoredLocale: true,
    children: withWorkspace ? React.createElement(LayoutProvider, { children: page }) : page,
  })));
  return onBack;
}

async function click(element: HTMLElement) {
  await act(() => element.click());
}

function tab(name: string) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('nav button'))
    .find((item) => item.textContent === name);
  expect(button).toBeDefined();
  return button!;
}

describe('Project internal page', () => {
  beforeEach(() => {
    localStorage.clear();
    mobile.value = false;
    role.value = 'admin';
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('shows the admin plan and a blank review panel after members', async () => {
    const onBack = await render();
    expect(container.querySelector('header')?.textContent).toBe('项目/测试项目');
    expect(Array.from(container.querySelectorAll('nav button'), (item) => item.textContent))
      .toEqual(['动态', '计划', '任务', '文件', '工作流', '浏览器', '知识库', '成员管理', '审核']);
    expect(tab('动态').getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('[data-testid="activity-module"]')).not.toBeNull();
    await click(tab('计划'));
    expect(tab('计划').getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('[data-testid="project-plan-page"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="project-plan-page"]')).not.toBeNull();
    await click(tab('成员管理'));
    expect(tab('成员管理').getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('[data-testid="project-tab-content"]')?.getAttribute('data-active-tab')).toBe('members');
    expect(container.querySelector('[data-testid="project-tab-content"]')?.childElementCount).toBe(0);
    await click(tab('审核'));
    expect(container.querySelector('[data-testid="project-tab-content"]')?.getAttribute('data-active-tab')).toBe('review');
    expect(container.querySelector('[data-testid="project-tab-content"]')?.childElementCount).toBe(0);
    await click(container.querySelector<HTMLButtonElement>('header button')!);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it.each(['member', 'viewer'])('keeps plan visible and review hidden for %s', async (memberRole) => {
    role.value = memberRole;
    await render(true, vi.fn(), 'plan');
    const labels = Array.from(container.querySelectorAll('nav button'), (item) => item.textContent);
    expect(labels).toContain('计划');
    expect(labels).not.toContain('审核');
    expect(tab('计划').getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('[data-testid="project-plan-page"]')).not.toBeNull();
  });

  it('embeds the five existing modules beneath the project navigation', async () => {
    await render();
    for (const [label, selectors] of [
      ['任务', ['tasks-module']],
      ['文件', ['files-list', 'files-detail']],
      ['工作流', ['workflows-module']],
      ['浏览器', ['browser-list', 'browser-detail']],
      ['知识库', ['knowledge-list', 'knowledge-detail']],
    ] as const) {
      await click(tab(label));
      expect(tab(label).getAttribute('aria-current')).toBe('page');
      for (const selector of selectors) expect(container.querySelector(`[data-testid="${selector}"]`)).not.toBeNull();
      expect(container.querySelector('header')?.textContent).toBe('项目/测试项目');
    }
  });

  it('switches local lists and details on mobile, resetting to list on each tab', async () => {
    mobile.value = true;
    await render();
    for (const [label, name] of [['文件', 'files'], ['浏览器', 'browser'], ['知识库', 'knowledge']]) {
      await click(tab(label));
      expect(container.querySelector(`[data-testid="${name}-list"]`)).not.toBeNull();
      expect(container.querySelector(`[data-testid="${name}-detail"]`)).toBeNull();
      await click(container.querySelector<HTMLButtonElement>(`[data-testid="${name}-list"]`)!);
      expect(container.querySelector(`[data-testid="${name}-list"]`)).toBeNull();
      expect(container.querySelector(`[data-testid="${name}-detail"]`)).not.toBeNull();
      await click(container.querySelector<HTMLButtonElement>(`[data-testid="${name}-detail"]`)!);
      expect(container.querySelector(`[data-testid="${name}-list"]`)).not.toBeNull();
    }
  });

  it('keeps the standalone preview stable without workspace providers', async () => {
    await render(false);
    await click(tab('任务'));
    expect(tab('任务').getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('[data-testid="project-tab-content"]')?.childElementCount).toBe(0);
    await click(tab('计划'));
    expect(container.querySelector('table')).not.toBeNull();
  });
});
