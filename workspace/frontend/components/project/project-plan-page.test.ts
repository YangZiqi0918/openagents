// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { ProjectPlanPage } from './project-plan-page';

const mock = vi.hoisted(() => ({
  getTeam: vi.fn(),
  workspaceId: 'workspace-1',
  agents: [{ agentName: 'codex', displayName: 'Codex' }],
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/lib/workspace-context', () => ({
  useWorkspace: () => ({
    workspace: { workspaceId: mock.workspaceId },
    agents: mock.agents,
  }),
}));
vi.mock('@/lib/api', () => ({ workspaceApi: { getTeam: mock.getTeam } }));

const STORAGE_KEY = 'oa:projects:workspace:workspace-1:v1:plan:project-1:v1';
let root: Root;
let container: HTMLDivElement;
const record = (id = 'a', title = '需求评审', extra = {}) => ({
  id,
  title,
  status: 'todo',
  assignee: null,
  priority: 'medium',
  tags: [],
  ...extra,
});

async function render(storageKey = STORAGE_KEY, withWorkspace = false, locale: 'zh-CN' | 'en-US' = 'zh-CN') {
  await act(() =>
    root.render(
      React.createElement(I18nProvider, {
        initialLocale: locale,
        hasStoredLocale: true,
        children: React.createElement(ProjectPlanPage, {
          projectId: 'project-1',
          storageKey,
          workspaceModulesAvailable: withWorkspace,
        }),
      }),
    ),
  );
}
function labelled<T extends Element = HTMLButtonElement>(label: string): T {
  const found = Array.from(document.querySelectorAll<T>('[aria-label]')).find(
    (element) => element.getAttribute('aria-label') === label,
  );
  expect(found, label).toBeDefined();
  return found!;
}
function button(text: string) {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (element) => element.textContent?.trim() === text,
  );
  expect(found, text).toBeDefined();
  return found!;
}
async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function fill(element: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function key(element: HTMLElement, value: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function select(label: string, value: string) {
  const element = labelled<HTMLElement>(label);
  if (element instanceof HTMLSelectElement) {
    await act(() => {
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return;
  }
  await click(element);
  if (label.startsWith('处理人')) {
    if (value === 'none') {
      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement>('[data-slot="popover-content"] input[type="checkbox"]:checked'),
      ))
        await click(input);
    } else {
      const name = value.startsWith('human:') ? '小林' : 'Codex';
      const entry = Array.from(document.querySelectorAll('label')).find((item) => item.textContent?.endsWith(name))!;
      await click(entry.querySelector('input')!);
    }
    await key(document.body, 'Escape');
  } else {
    const name = (
      {
        todo: '待开始',
        doing: '进行中',
        paused: '已暂停',
        done: '已完成',
        low: '低',
        medium: '中',
        high: '高',
        urgent: '紧急',
        none: '无',
      } as Record<string, string>
    )[value];
    await click(
      Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).find(
        (item) => item.textContent === name,
      )!,
    );
  }
}

const saved = (storageKey = STORAGE_KEY) => JSON.parse(localStorage.getItem(storageKey)!);
async function add(title: string) {
  await click(button('添加'));
  const input = labelled<HTMLInputElement>('标题');
  expect(document.activeElement).toBe(input);
  await fill(input, title);
  await click(button('创建'));
}

async function search(text: string) {
  await click(labelled('搜索'));
  await fill(labelled<HTMLInputElement>('搜索标题、描述、处理人或标签'), text);
}

describe('Project plan table', () => {
  beforeEach(() => {
    localStorage.clear();
    mock.workspaceId = 'workspace-1';
    mock.getTeam.mockReset().mockResolvedValue([{ email: 'lin@example.com', displayName: '小林' }]);
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

  it('renders the empty reference table without seeding or requesting members in preview', async () => {
    await render();
    expect(Array.from(container.querySelectorAll('th'), (element) => element.textContent)).toEqual([
      '',
      '标题',
      '状态',
      '处理人',
      '优先级',
      '标签',
    ]);
    expect(container.querySelectorAll('[data-testid="plan-record"]')).toHaveLength(0);
    expect(container.querySelectorAll('[aria-label="添加记录"]')).toHaveLength(1);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(mock.getTeam).not.toHaveBeenCalled();
  });

  it('adds a focused draft, submits once and immediately saves dropdown edits', async () => {
    await render();
    await add('  实现登录  ');
    expect(saved()).toEqual([
      expect.objectContaining({
        title: '实现登录',
        status: 'todo',
        priority: null,
        assignees: [],
        tags: [],
      }),
    ]);
    expect(container.querySelectorAll('[data-testid="plan-record"]')).toHaveLength(1);
    await select('状态: 实现登录', 'doing');
    await select('优先级: 实现登录', 'high');
    expect(saved()[0]).toMatchObject({ status: 'doing', priority: 'high' });
  });

  it('expands and restores the new dialog without changing the draft', async () => {
    await render();
    await click(button('添加'));
    await fill(labelled<HTMLInputElement>('标题'), '草稿标题');
    await click(labelled('放大'));
    expect(document.querySelector('[role="dialog"]')?.className).toContain('inset-0');
    await click(labelled('还原'));
    expect(labelled<HTMLInputElement>('标题').value).toBe('草稿标题');
    expect(container.querySelectorAll('[data-testid="plan-record"]')).toHaveLength(0);
  });

  it('uses the Add and bottom plus controls and discards unchanged forms on Escape', async () => {
    await render();
    for (const control of [button('添加'), labelled('添加记录')]) {
      await click(control);
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      await key(labelled('标题'), 'Escape');
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    }
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('disables creation for blank titles and preserves existing titles when cancelled', async () => {
    await render();
    await click(button('添加'));
    expect(button('创建').disabled).toBe(true);
    await fill(labelled<HTMLInputElement>('标题'), '  ');
    expect(button('创建').disabled).toBe(true);
    await click(button('取消'));
    await click(button('放弃修改'));
    await add('原始标题');
    await click(labelled('编辑标题: 原始标题'));
    await fill(labelled<HTMLInputElement>('编辑标题: 原始标题'), '  ');
    await key(labelled('编辑标题: 原始标题'), 'Enter');
    expect(saved()[0].title).toBe('原始标题');
    expect(container.textContent).toContain('标题不能为空');
    await key(labelled('编辑标题: 原始标题'), 'Escape');
    expect(container.textContent).toContain('原始标题');
  });

  it('commits titles on blur and searches, adds and reuses deduplicated tags', async () => {
    await render();
    await add('需求');
    await click(labelled('编辑标签: 需求'));
    await fill(labelled<HTMLInputElement>('搜索或新增标签'), ' 开发 ');
    await click(button('新增标签: 开发'));
    await fill(labelled<HTMLInputElement>('搜索或新增标签'), '开发');
    expect(Array.from(document.querySelectorAll('button')).some((item) => item.textContent === '新增标签: 开发')).toBe(
      false,
    );
    await fill(labelled<HTMLInputElement>('搜索或新增标签'), '前端');
    await click(button('新增标签: 前端'));
    await key(document.body, 'Escape');
    expect(saved()[0].tags).toEqual(['开发', '前端']);
    await click(labelled('编辑标题: 需求'));
    const title = labelled<HTMLInputElement>('编辑标题: 需求');
    await fill(title, '新需求');
    await act(() => title.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(saved()[0].title).toBe('新需求');
  });

  it('selects multiple human and agent assignees and supports clearing them', async () => {
    await render(STORAGE_KEY, true);
    await add('负责人测试');
    await select('处理人: 负责人测试', 'human:lin@example.com');
    expect(saved()[0].assignees).toEqual([
      expect.objectContaining({ id: 'human:lin@example.com', name: '小林', kind: 'human' }),
    ]);
    await select('处理人: 负责人测试', 'agent:codex');
    expect(saved()[0].assignees.map((item: { name: string }) => item.name)).toEqual(['小林', 'Codex']);
    await select('处理人: 负责人测试', 'none');
    expect(saved()[0].assignees).toEqual([]);
  });

  it('retains a removed assignee on its record without offering it for new assignments', async () => {
    const assignee = { id: 'human:old@example.com', name: '历史成员', kind: 'human' };
    const raw = JSON.stringify([record('a', '旧记录', { assignee }), record('b', '新记录')]);
    localStorage.setItem(STORAGE_KEY, raw);
    await render(STORAGE_KEY, true);
    expect(labelled('处理人: 旧记录').textContent).toContain('历史成员');
    await click(labelled('处理人: 新记录'));
    expect(document.querySelector('[data-slot="popover-content"]')?.textContent).not.toContain('历史成员');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
  });

  it('reports member failures, preserves table editing and retries loading', async () => {
    mock.getTeam.mockRejectedValueOnce(new Error('Offline'));
    await render(STORAGE_KEY, true);
    expect(container.textContent).toContain('工作区成员加载失败');
    await add('本地编辑');
    await click(button('重试'));
    expect(mock.getTeam).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('工作区成员加载失败');
    await select('处理人: 本地编辑', 'human:lin@example.com');
    expect(saved()[0].assignees[0].name).toBe('小林');
  });

  it('shows member loading without blocking local record creation', async () => {
    let finish!: (members: unknown[]) => void;
    mock.getTeam.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render(STORAGE_KEY, true);
    expect(container.textContent).toContain('正在加载成员');
    await add('离线准备');
    expect(labelled<HTMLSelectElement>('处理人: 离线准备').disabled).toBe(true);
    await act(() => finish([]));
    expect(labelled<HTMLSelectElement>('处理人: 离线准备').disabled).toBe(false);
  });

  it('ignores member requests resolved after changing workspace', async () => {
    let finish!: (members: unknown[]) => void;
    mock.getTeam.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render(STORAGE_KEY, true);
    mock.workspaceId = 'workspace-2';
    localStorage.setItem('other', JSON.stringify([record()]));
    await render('other', true);
    await act(() => finish([{ email: 'stale@example.com', displayName: '过期成员' }]));
    await click(labelled('处理人: 需求评审'));
    const choices = document.querySelector('[data-slot="popover-content"]')!;
    expect(choices.textContent).toContain('小林');
    expect(choices.textContent).not.toContain('过期成员');
  });

  it('searches titles, assignee names and tags and handles no results', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        record('a', '登录'),
        record('b', '界面', {
          tags: ['前端'],
          assignee: { id: 'human:lin', name: '小林', kind: 'human' },
        }),
      ]),
    );
    await render();
    await search('小林');
    expect(container.querySelectorAll('[data-testid="plan-record"]')).toHaveLength(1);
    await fill(labelled<HTMLInputElement>('搜索标题、描述、处理人或标签'), '前端');
    expect(container.querySelectorAll('[data-testid="plan-record"]')).toHaveLength(1);
    await fill(labelled<HTMLInputElement>('搜索标题、描述、处理人或标签'), '不存在');
    expect(container.textContent).toContain('没有匹配的记录');
    await click(labelled('关闭搜索'));
    expect(container.querySelectorAll('[data-testid="plan-record"]')).toHaveLength(2);
  });

  it('combines status, assignee and priority filters and clears them', async () => {
    const assignee = { id: 'agent:codex', name: 'Codex', kind: 'agent' };
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        record('a', '目标', { status: 'doing', priority: 'high', assignee }),
        record('b', '其他', { status: 'doing' }),
      ]),
    );
    await render();
    await click(labelled('筛选'));
    await select('筛选状态', 'doing');
    await select('筛选优先级', 'high');
    await select('筛选处理人', 'agent:codex');
    expect(container.querySelectorAll('[data-testid="plan-record"]')).toHaveLength(1);
    await click(button('清空筛选'));
    expect(container.querySelectorAll('[data-testid="plan-record"]')).toHaveLength(2);
  });

  it('toggles optional columns while keeping title and selection columns', async () => {
    await render();
    await click(labelled('列设置'));
    const label = Array.from(document.querySelectorAll('label')).find((element) => element.textContent === '状态')!;
    await click(label.querySelector('input')!);
    expect(Array.from(container.querySelectorAll('th'), (element) => element.textContent)).toEqual([
      '',
      '标题',
      '处理人',
      '优先级',
      '标签',
    ]);
    await click(label.querySelector('input')!);
    expect(container.querySelectorAll('th')).toHaveLength(6);
  });

  it('selects only visible results and confirms or cancels deletion', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([record('a', '删除目标'), record('b', '保留')]));
    await render();
    await search('删除');
    await click(labelled('全选当前记录'));
    await click(labelled('删除所选记录'));
    await click(button('取消'));
    expect(saved()).toHaveLength(2);
    await click(labelled('删除所选记录'));
    await click(button('确认删除'));
    expect(saved().map((row: { id: string }) => row.id)).toEqual(['b']);
    await click(labelled('关闭搜索'));
    expect(container.textContent).toContain('保留');
  });

  it('shows a blank board without tools and restores records and filters when switching back', async () => {
    await render();
    await add('保持记录');
    await search('保持');
    await click(button('看板'));
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('[data-testid="plan-board"]')?.childElementCount).toBe(0);
    expect(container.querySelector('[aria-label="搜索"]')).toBeNull();
    expect(container.textContent).not.toContain('保持记录');
    await click(button('表格'));
    expect(container.textContent).toContain('保持记录');
    expect(labelled<HTMLInputElement>('搜索标题、描述、处理人或标签').value).toBe('保持');
  });

  it('restores saved records on remount', async () => {
    await render();
    await add('持久记录');
    await act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.textContent).toContain('持久记录');
    expect(container.querySelectorAll('[data-testid="plan-record"]')).toHaveLength(1);
  });

  it('isolates projects, workspaces and preview keys and resets transient state', async () => {
    await render();
    await add('项目一');
    await search('项目一');
    for (const storageKey of [
      'oa:projects:workspace:workspace-1:v1:plan:project-2:v1',
      'oa:projects:workspace:workspace-2:v1:plan:project-1:v1',
      'oa:projects:preview:v1:plan:project-1:v1',
    ]) {
      await render(storageKey);
      expect(container.querySelectorAll('[data-testid="plan-record"]')).toHaveLength(0);
      expect(container.querySelector('input[type="search"]')).toBeNull();
      await add(storageKey);
      expect(saved(storageKey)).toHaveLength(1);
    }
    await render();
    expect(container.textContent).toContain('项目一');
    expect(saved()).toHaveLength(1);
  });

  it.each(['{broken', JSON.stringify([record('a', '')]), JSON.stringify([record(), record()])])(
    'does not overwrite invalid storage (%s) until reset is confirmed',
    async (raw) => {
      localStorage.setItem(STORAGE_KEY, raw);
      await render();
      expect(container.textContent).toContain('原有数据未被覆盖');
      expect(button('添加').disabled).toBe(true);
      expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
      await click(button('重置计划数据'));
      await click(button('取消'));
      expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
      await click(button('重置计划数据'));
      await click(button('确认重置'));
      expect(saved()).toEqual([]);
      expect(button('添加').disabled).toBe(false);
    },
  );

  it('retries storage read errors without overwriting existing data', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([record()]));
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    await render();
    expect(container.textContent).toContain('原有数据未被覆盖');
    read.mockRestore();
    await click(button('重试'));
    expect(container.textContent).toContain('需求评审');
    expect(saved()).toHaveLength(1);
  });

  it('keeps unsaved inline edits in memory and retries the latest version', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([record('a', '原始')]));
    await render();
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota');
    });
    await click(labelled('编辑标题: 原始'));
    await fill(labelled<HTMLInputElement>('编辑标题: 原始'), '未保存');
    await key(labelled('编辑标题: 原始'), 'Enter');
    await select('状态: 未保存', 'done');
    expect(container.textContent).toContain('当前修改尚未保存');
    expect(saved()[0].title).toBe('原始');
    write.mockRestore();
    await click(button('重试'));
    expect(saved()[0]).toMatchObject({ title: '未保存', status: 'done' });
  });

  it('retains a failed create draft and retries without inserting duplicate records', async () => {
    await render();
    await click(button('添加'));
    await fill(labelled<HTMLInputElement>('标题'), '未保存');
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota');
    });
    await click(button('创建'));
    expect(document.body.textContent).toContain('草稿已保留');
    expect(container.querySelectorAll('[data-testid="plan-record"]')).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    write.mockRestore();
    await click(button('创建'));
    expect(saved()).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('edits details atomically and searches descriptions and any selected assignee', async () => {
    await render();
    await add('详情');
    await click(labelled('编辑待办详情: 详情'));
    const description = labelled<HTMLTextAreaElement>('描述');
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(description, '业务背景');
      description.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(saved()[0].description).toBe('');
    await click(button('保存'));
    expect(saved()[0].description).toBe('业务背景');
    await search('业务背景');
    expect(container.querySelectorAll('[data-testid="plan-record"]')).toHaveLength(1);
  });

  it('keeps a failed confirmed reset retryable', async () => {
    localStorage.setItem(STORAGE_KEY, '{broken');
    await render();
    await click(button('重置计划数据'));
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota');
    });
    await click(button('确认重置'));
    expect(container.textContent).toContain('保存失败');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{broken');
    write.mockRestore();
    await click(button('重试'));
    expect(saved()).toEqual([]);
  });

  it('renders English labels without changing persisted data', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([record()]));
    await render(STORAGE_KEY, false, 'en-US');
    expect(container.querySelector('table')?.getAttribute('aria-label')).toBe('Plan table');
    expect(container.textContent).toContain('需求评审');
    expect(saved()[0].status).toBe('todo');
  });
});
