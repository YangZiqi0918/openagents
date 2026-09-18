// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { DialogsProvider } from '@/components/ui/dialogs-provider';
import { ProjectsView } from './projects-view';

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('./project-activity-page', () => ({ ProjectActivityPage: () => React.createElement('div', { 'data-testid': 'activity-module' }) }));

const STORAGE_KEY = 'test:projects';
let root: Root;
let container: HTMLDivElement;

async function render() {
  await act(() => root.render(React.createElement(I18nProvider, {
    initialLocale: 'zh-CN', hasStoredLocale: true,
    children: React.createElement(DialogsProvider, {
      children: React.createElement(ProjectsView, { storageKey: STORAGE_KEY }),
    }),
  })));
}

function button(text: string) {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find((item) => item.textContent?.trim() === text);
  expect(found).toBeDefined();
  return found!;
}

async function fill(input: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(element: HTMLElement) {
  await act(() => element.click());
}

function dialogInput() {
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input');
  expect(input).not.toBeNull();
  return input!;
}

async function openActions() {
  const trigger = container.querySelector<HTMLButtonElement>('[data-testid="project-card"] [data-slot="dropdown-menu-trigger"]');
  expect(trigger).not.toBeNull();
  await act(() => trigger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
}

async function menuItem(text: string) {
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    .find((element) => element.textContent === text);
  expect(item).toBeDefined();
  await click(item!);
}

describe('Projects interactions', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    localStorage.clear();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('matches the reference sections, illustration, projects and five templates', async () => {
    await render();
    expect(container.querySelector('h1')?.textContent).toBe('项目');
    expect(Array.from(container.querySelectorAll('h2')).map((item) => item.textContent))
      .toEqual(['我的项目', '从模版创建']);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/assets/images/project-team-reference.png');
    expect(container.querySelectorAll('[data-testid="project-card"]')).toHaveLength(2);
    expect(container.textContent).toContain('项目新手指引');
    expect(container.textContent).toContain('添加于 1 个月前');
    expect(container.textContent).toContain('添加于 22 天前');
    expect(container.querySelectorAll('section')[1].querySelectorAll('button')).toHaveLength(5);
  });

  it('filters only projects, keeps templates visible and handles no results', async () => {
    await render();
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await fill(search, '新手');
    expect(container.querySelectorAll('[data-testid="project-card"]')).toHaveLength(1);
    expect(container.textContent).toContain('产品需求全流程');
    await fill(search, 'not-a-project');
    expect(container.querySelectorAll('[data-testid="project-card"]')).toHaveLength(0);
    expect(container.textContent).toContain('没有匹配的项目');
    await click(container.querySelector<HTMLButtonElement>('[aria-label="清空搜索"]')!);
    expect(container.querySelectorAll('[data-testid="project-card"]')).toHaveLength(2);
  });

  it('creates a named project and persists it', async () => {
    await render();
    await click(button('新建项目'));
    expect(button('创建').disabled).toBe(true);
    await fill(dialogInput(), '新项目');
    await click(button('创建'));
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved[0].name).toBe('新项目');
    expect(container.querySelector('[data-testid="project-internal-page"]')?.getAttribute('data-project-id')).toBe(saved[0].id);
    expect(container.querySelector('header')?.textContent).toContain('项目/新项目');
    expect(container.querySelectorAll('[data-testid="project-card"]')).toHaveLength(0);
    await click(button('项目'));
    expect(container.querySelectorAll('[data-testid="project-card"]')).toHaveLength(3);
  });

  it('creates a project from a template with its description', async () => {
    await render();
    const template = Array.from(container.querySelectorAll<HTMLButtonElement>('section button'))
      .find((item) => item.textContent?.startsWith('市场调研与竞品分析'))!;
    await click(template);
    expect(dialogInput().value).toBe('市场调研与竞品分析');
    await click(button('创建'));
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved[0].description).toBe('深度调研、竞品拆解、报告评审');
    expect(container.querySelector('[data-testid="project-internal-page"]')?.getAttribute('data-project-id')).toBe(saved[0].id);
    expect(container.textContent).not.toContain(saved[0].description);
  });

  it('opens existing projects in the same page module', async () => {
    await render();
    const cards = container.querySelectorAll<HTMLButtonElement>('[data-testid="project-card"] > button:first-child');
    await click(cards[0]);
    const page = container.querySelector('[data-testid="project-internal-page"]');
    expect(page?.getAttribute('data-project-id')).toBe('getting-started');
    expect(page?.querySelector('header')?.textContent).toContain('项目新手指引');
    expect(page?.querySelector('[data-testid="activity-module"]')).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await click(button('项目'));
    await click(container.querySelectorAll<HTMLButtonElement>('[data-testid="project-card"] > button:first-child')[1]);
    expect(container.querySelector('[data-testid="project-internal-page"]')?.getAttribute('data-project-id')).toBe('example-1');
    expect(container.querySelector('header')?.textContent).toContain('项目/1');
  });

  it('opens a linked project temporarily, without changing the local project list', async () => {
    localStorage.setItem(STORAGE_KEY, '[]');
    window.history.replaceState(null, '', '/workspace?projectId=shared&projectName=Shared&projectSessionId=project:shared:abc');
    await render();
    expect(container.querySelector('[data-testid="project-internal-page"]')?.getAttribute('data-project-id')).toBe('shared');
    expect(container.querySelector('header')?.textContent).toBe('项目/Shared');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('[]');
    await click(button('项目'));
    expect(container.querySelector('[data-testid="projects-view"]')).not.toBeNull();
    expect(window.location.search).toBe('');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('[]');
  });

  it('handles navigation between project links in the same workspace', async () => {
    await render();
    await act(() => {
      window.history.pushState(null, '', '/workspace?projectId=shared&projectName=Shared');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(container.querySelector('[data-testid="project-internal-page"]')?.getAttribute('data-project-id')).toBe('shared');
    await act(() => {
      window.history.pushState(null, '', '/workspace?projectId=other&projectName=Other');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(container.querySelector('[data-testid="project-internal-page"]')?.getAttribute('data-project-id')).toBe('other');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('renames a project from its menu', async () => {
    await render();
    await openActions();
    await menuItem('重命名');
    await fill(dialogInput(), '团队项目');
    await click(button('保存'));
    expect(container.textContent).toContain('团队项目');
    expect(container.textContent).not.toContain('项目新手指引');
  });

  it('requires confirmation before deleting a project', async () => {
    await render();
    await openActions();
    await menuItem('删除');
    await click(button('取消'));
    expect(container.querySelectorAll('[data-testid="project-card"]')).toHaveLength(2);
    await openActions();
    await menuItem('删除');
    await click(button('删除'));
    expect(container.querySelectorAll('[data-testid="project-card"]')).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toHaveLength(1);
  });

  it('restores saved projects and preserves an intentionally empty list', async () => {
    localStorage.setItem(STORAGE_KEY, '[]');
    await render();
    expect(container.textContent).toContain('暂无项目');
    expect(container.querySelectorAll('[data-testid="project-card"]')).toHaveLength(0);
  });

  it('recovers from malformed storage without crashing', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ name: 'invalid' }]));
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('无法读取已保存的项目。');
    expect(container.querySelectorAll('[data-testid="project-card"]')).toHaveLength(2);
  });

  it('reports save failures while retaining the current in-memory project', async () => {
    await render();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    await click(button('新建项目'));
    await fill(dialogInput(), '未保存的项目');
    await click(button('创建'));
    expect(container.querySelector('[data-testid="project-internal-page"]')).not.toBeNull();
    await click(button('项目'));
    expect(container.textContent).toContain('未保存的项目');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('无法保存项目');
  });
});
