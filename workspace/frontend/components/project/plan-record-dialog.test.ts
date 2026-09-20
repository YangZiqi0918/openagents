// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { PlanRecordDialog } from './plan-record-dialog';
import { EMPTY_MEMBERS, newPlanRecord, todayDate, type PlanRecord } from './plan-record-model';

const mock = vi.hoisted(() => ({ upload: vi.fn(), url: vi.fn((id: string) => `/files/${id}`), deleteFile: vi.fn() }));
vi.mock('@/lib/api', () => ({
  workspaceApi: { uploadFile: mock.upload, getFileUrl: mock.url, deleteFile: mock.deleteFile },
}));
let root: Root;
let container: HTMLDivElement;
const save = vi.fn();
const close = vi.fn();
async function render(initial = newPlanRecord(), canUpload = true, editing = false) {
  await act(() =>
    root.render(
      React.createElement(I18nProvider, {
        initialLocale: 'zh-CN',
        hasStoredLocale: true,
        children: React.createElement(PlanRecordDialog, {
          initial,
          editing,
          canUpload,
          members: EMPTY_MEMBERS,
          tagOptions: [],
          onSave: save,
          onClose: close,
        }),
      }),
    ),
  );
}
function label<T extends HTMLElement = HTMLButtonElement>(name: string) {
  const found = Array.from(document.querySelectorAll<T>('[aria-label]')).find(
    (element) => element.getAttribute('aria-label') === name,
  );
  expect(found, name).toBeDefined();
  return found!;
}
function button(name: string) {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (element) => element.textContent?.trim() === name,
  );
  expect(found, name).toBeDefined();
  return found!;
}
async function click(element: HTMLElement) {
  await act(() => element.click());
}
async function fill(name: string, value: string) {
  await act(() => {
    const element = label<HTMLInputElement>(name);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function fillTextarea(name: string, value: string) {
  await act(() => {
    const element = label<HTMLTextAreaElement>(name);
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function files(...names: string[]) {
  await act(() => {
    const input = label<HTMLInputElement>('添加附件');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: names.map((name) => new File(['contents'], name, { type: 'text/plain', lastModified: 1 })),
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('Plan record dialog', () => {
  beforeEach(() => {
    save.mockReset().mockReturnValue(true);
    close.mockReset();
    mock.upload
      .mockReset()
      .mockResolvedValue({ id: 'file-1', filename: 'one.txt', contentType: 'text/plain', size: 8 });
    mock.url.mockClear();
    mock.deleteFile.mockClear();
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

  it('starts with no priority, disables blank titles and trims titles on submit', async () => {
    await render();
    expect(button('创建').disabled).toBe(true);
    await fill('标题', '  标题  ');
    await click(button('创建'));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ title: '标题', priority: null, status: 'todo', assignees: [] }),
    );
    expect(close).toHaveBeenCalledOnce();
  });
  it('closes unchanged forms directly and confirms changed forms before discarding', async () => {
    await render();
    await click(button('取消'));
    expect(close).toHaveBeenCalledOnce();
    close.mockClear();
    await fill('标题', '草稿');
    await click(label('关闭'));
    expect(document.body.textContent).toContain('放弃未保存的修改');
    await click(button('继续编辑'));
    expect(close).not.toHaveBeenCalled();
    await click(button('取消'));
    await click(button('放弃修改'));
    expect(close).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  });
  it('formats both Markdown fields, restores their selections and saves the controlled draft', async () => {
    await render();
    await fill('标题', '发布计划');
    await fillTextarea('描述', '发布版本');
    const description = label<HTMLTextAreaElement>('描述');
    await act(() => {
      description.focus();
      description.setSelectionRange(0, 2);
    });
    await click(label('描述：加粗'));
    expect(description.value).toBe('**发布**版本');
    expect(document.activeElement).toBe(description);
    expect([description.selectionStart, description.selectionEnd]).toEqual([2, 4]);

    await fillTextarea('验收标准', '完成测试\n发布报告');
    const acceptanceCriteria = label<HTMLTextAreaElement>('验收标准');
    await act(() => {
      acceptanceCriteria.focus();
      acceptanceCriteria.setSelectionRange(0, acceptanceCriteria.value.length);
    });
    await click(label('验收标准：任务列表'));
    expect(acceptanceCriteria.value).toBe('- [ ] 完成测试\n- [ ] 发布报告');
    expect(document.activeElement).toBe(acceptanceCriteria);
    expect(save).not.toHaveBeenCalled();

    await click(button('创建'));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        description: '**发布**版本',
        acceptanceCriteria: '- [ ] 完成测试\n- [ ] 发布报告',
      }),
    );
  });
  it('offers every supported Markdown action and inserts link and code syntax without submitting', async () => {
    await render();
    const description = label<HTMLTextAreaElement>('描述');
    const toolbar = label<HTMLElement>('描述 Markdown 工具栏');
    expect(toolbar.getAttribute('aria-controls')).toBe(description.id);
    for (const action of ['加粗', '斜体', '删除线', '无序列表', '有序列表', '任务列表', '引用', '行内代码', '代码块', '链接']) {
      expect(label(`描述：${action}`)).toBeDefined();
    }

    await fillTextarea('描述', 'API');
    await act(() => {
      description.focus();
      description.setSelectionRange(0, description.value.length);
    });
    const linkButton = label('描述：链接');
    await act(() => linkButton.focus());
    expect(document.activeElement).toBe(linkButton);
    await click(linkButton);
    expect(description.value).toBe('[API](https://)');
    expect(description.value).not.toContain('<');
    expect(description.value.slice(description.selectionStart, description.selectionEnd)).toBe('https://');
    expect(document.activeElement).toBe(description);
    expect(save).not.toHaveBeenCalled();
  });
  it('confirms dirty Escape and does not close when the overlay is clicked', async () => {
    await render();
    await fill('标题', '草稿');
    const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!;
    await click(overlay);
    expect(close).not.toHaveBeenCalled();
    await act(() => label('标题').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.body.textContent).toContain('放弃未保存的修改');
  });
  it('allows historical dates and blocks conflicting due dates without clearing them', async () => {
    await render();
    await fill('标题', '日期');
    await fill('开始日期', '2020-01-10');
    await fill('截止日期', '2020-01-11');
    expect(button('创建').disabled).toBe(false);
    await fill('开始日期', '2020-01-12');
    expect(button('创建').disabled).toBe(true);
    expect(label<HTMLInputElement>('截止日期').value).toBe('2020-01-11');
    expect(document.body.textContent).toContain('截止日期不得早于开始日期');
    await click(label('截止日期: 清除'));
    expect(button('创建').disabled).toBe(false);
    await click(label('开始日期: 今天'));
    expect(label<HTMLInputElement>('开始日期').value).toBe(todayDate());
    await click(button('创建'));
    expect(save.mock.calls[0][0].startDate).toBe(todayDate());
  });
  it('stages attachments without uploading before submission and stores only metadata', async () => {
    await render();
    await fill('标题', '文件');
    await files('one.txt');
    expect(mock.upload).not.toHaveBeenCalled();
    await click(button('创建'));
    expect(mock.upload).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0].attachments).toEqual([
      { id: 'file-1', filename: 'one.txt', contentType: 'text/plain', size: 8 },
    ]);
  });
  it('retries only failed uploads and avoids saving partially uploaded records', async () => {
    mock.upload
      .mockResolvedValueOnce({ id: 'one', filename: 'one.txt', contentType: 'text/plain', size: 8 })
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ id: 'two', filename: 'two.txt', contentType: 'text/plain', size: 8 });
    await render();
    await fill('标题', '部分失败');
    await files('one.txt', 'two.txt');
    await click(button('创建'));
    expect(save).not.toHaveBeenCalled();
    expect(mock.upload).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain('Network error');
    await click(label('重试: two.txt'));
    expect(mock.upload).toHaveBeenCalledTimes(3);
    expect(mock.upload.mock.calls.map((call) => call[0].name)).toEqual(['one.txt', 'two.txt', 'two.txt']);
    expect(save.mock.calls[0][0].attachments).toHaveLength(2);
  });
  it('can remove a failed attachment and submit the successful references without deleting files', async () => {
    mock.upload
      .mockResolvedValueOnce({ id: 'one', filename: 'one.txt', contentType: 'text/plain', size: 8 })
      .mockRejectedValueOnce(new Error('Permission denied'));
    await render();
    await fill('标题', '移除失败');
    await files('one.txt', 'two.txt');
    await click(button('创建'));
    await click(label('移除附件: two.txt'));
    await click(button('创建'));
    expect(mock.upload).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0][0].attachments).toHaveLength(1);
    expect(mock.deleteFile).not.toHaveBeenCalled();
  });
  it('keeps uploaded references after local save failure and retries using the same record id', async () => {
    save.mockReturnValueOnce(false).mockReturnValueOnce(true);
    await render();
    await fill('标题', '存储失败');
    await files('one.txt');
    await click(button('创建'));
    expect(document.body.textContent).toContain('草稿已保留');
    expect(close).not.toHaveBeenCalled();
    await click(button('创建'));
    expect(mock.upload).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0].id).toBe(save.mock.calls[1][0].id);
    expect(close).toHaveBeenCalledOnce();
  });
  it('cancels upload, ignores late completion and can retry the pending file', async () => {
    const pending = deferred<{ id: string; filename: string; contentType: string; size: number }>();
    mock.upload.mockReturnValueOnce(pending.promise);
    await render();
    await fill('标题', '取消上传');
    await files('one.txt');
    await click(button('创建'));
    const signal: AbortSignal = mock.upload.mock.calls[0][2].signal;
    await click(button('取消上传'));
    expect(signal.aborted).toBe(true);
    await act(() => pending.resolve({ id: 'late', filename: 'late.txt', contentType: 'text/plain', size: 8 }));
    expect(save).not.toHaveBeenCalled();
    await click(button('创建'));
    expect(save.mock.calls[0][0].attachments[0].id).toBe('file-1');
  });
  it('aborts upload when a dirty form is discarded and ignores late results', async () => {
    const pending = deferred<unknown>();
    mock.upload.mockReturnValueOnce(pending.promise);
    await render();
    await fill('标题', '退出上传');
    await files('one.txt');
    await click(button('创建'));
    await click(label('关闭'));
    await click(button('放弃修改'));
    expect(mock.upload.mock.calls[0][2].signal.aborted).toBe(true);
    await act(() => pending.resolve({ id: 'late' }));
    expect(save).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
  it('ignores upload results after unmounting', async () => {
    const pending = deferred<unknown>();
    mock.upload.mockReturnValueOnce(pending.promise);
    await render();
    await fill('标题', '离开页面');
    await files('one.txt');
    await click(button('创建'));
    await act(() => root.unmount());
    root = createRoot(container);
    await act(() => pending.resolve({ id: 'late' }));
    expect(save).not.toHaveBeenCalled();
  });
  it('shows progress and prevents double submission while uploading', async () => {
    const pending = deferred<unknown>();
    mock.upload.mockImplementationOnce((_file, _channel, options) => {
      options.onProgress(0.5);
      return pending.promise;
    });
    await render();
    await fill('标题', '上传进度');
    await files('one.txt');
    await click(button('创建'));
    expect(document.querySelector<HTMLProgressElement>('progress')?.value).toBe(0.5);
    expect(button('正在提交').disabled).toBe(true);
    await click(button('正在提交'));
    expect(mock.upload).toHaveBeenCalledOnce();
    await click(button('取消上传'));
    await act(() => pending.resolve({ id: 'late' }));
  });
  it('disables upload in preview mode and never calls upload', async () => {
    await render(newPlanRecord(), false);
    expect(label('预览模式不支持附件上传').getAttribute('disabled')).not.toBeNull();
    expect(label<HTMLInputElement>('添加附件').disabled).toBe(true);
    expect(mock.upload).not.toHaveBeenCalled();
  });
  it('uses arrow keys in status menus and does not submit when searching tags or members', async () => {
    await render();
    await fill('标题', '键盘操作');
    await click(label('状态'));
    const first = document.querySelector<HTMLElement>('[role="menuitemradio"]')!;
    await act(() => {
      first.focus();
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(document.activeElement?.textContent).toBe('已完成');
    await click(document.activeElement as HTMLElement);
    await click(label('标签'));
    await fill('搜索或新增标签', '新标签');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(() => label('搜索或新增标签').dispatchEvent(enter));
    expect(enter.defaultPrevented).toBe(true);
    expect(save).not.toHaveBeenCalled();
    await act(() => label('搜索或新增标签').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await click(label('处理人'));
    const memberEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(() => label('搜索成员').dispatchEvent(memberEnter));
    expect(memberEnter.defaultPrevented).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
  it('views and removes existing references without deleting workspace files', async () => {
    const initial: PlanRecord = {
      ...newPlanRecord(),
      title: '已有附件',
      attachments: [{ id: 'old', filename: 'old.txt', contentType: 'text/plain', size: 2 }],
    };
    await render(initial, true, true);
    expect(label<HTMLAnchorElement>('查看附件: old.txt').getAttribute('href')).toBe('/files/old');
    await click(label('移除附件: old.txt'));
    await click(button('保存'));
    expect(save.mock.calls[0][0].attachments).toEqual([]);
    expect(mock.deleteFile).not.toHaveBeenCalled();
  });
});
