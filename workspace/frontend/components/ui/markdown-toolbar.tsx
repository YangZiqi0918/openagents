'use client';

import { Fragment, useLayoutEffect, useRef, type RefObject } from 'react';
import {
  Bold,
  Code,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  SquareCode,
  Strikethrough,
  type LucideIcon,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type MarkdownAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'quote'
  | 'inlineCode'
  | 'codeBlock'
  | 'link';

interface MarkdownEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

const COPY = {
  'zh-CN': {
    toolbar: 'Markdown 工具栏',
    bold: '加粗',
    italic: '斜体',
    strike: '删除线',
    bulletList: '无序列表',
    orderedList: '有序列表',
    taskList: '任务列表',
    quote: '引用',
    inlineCode: '行内代码',
    codeBlock: '代码块',
    link: '链接',
  },
  'en-US': {
    toolbar: 'Markdown toolbar',
    bold: 'Bold',
    italic: 'Italic',
    strike: 'Strikethrough',
    bulletList: 'Bulleted list',
    orderedList: 'Numbered list',
    taskList: 'Task list',
    quote: 'Quote',
    inlineCode: 'Inline code',
    codeBlock: 'Code block',
    link: 'Link',
  },
} as const;

const ACTION_GROUPS: { action: MarkdownAction; icon: LucideIcon }[][] = [
  [
    { action: 'bold', icon: Bold },
    { action: 'italic', icon: Italic },
    { action: 'strike', icon: Strikethrough },
  ],
  [
    { action: 'bulletList', icon: List },
    { action: 'orderedList', icon: ListOrdered },
    { action: 'taskList', icon: ListChecks },
    { action: 'quote', icon: Quote },
  ],
  [
    { action: 'inlineCode', icon: Code },
    { action: 'codeBlock', icon: SquareCode },
  ],
  [{ action: 'link', icon: Link }],
];

function replaceRange(value: string, start: number, end: number, replacement: string): string {
  return `${value.slice(0, start)}${replacement}${value.slice(end)}`;
}

function wrap(value: string, start: number, end: number, before: string, after: string): MarkdownEdit {
  const selected = value.slice(start, end);
  return {
    value: replaceRange(value, start, end, `${before}${selected}${after}`),
    selectionStart: start + before.length,
    selectionEnd: start + before.length + selected.length,
  };
}

function prefixLines(
  value: string,
  start: number,
  end: number,
  prefix: (index: number) => string,
): MarkdownEdit {
  const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
  const selectionEndsAtLineStart = end > start && value[end - 1] === '\n';
  const searchFrom = selectionEndsAtLineStart ? end - 1 : end;
  const nextLineBreak = value.indexOf('\n', searchFrom);
  const lineEnd = selectionEndsAtLineStart ? end - 1 : nextLineBreak === -1 ? value.length : nextLineBreak;
  const block = value.slice(lineStart, lineEnd);
  const replacement = block
    .split('\n')
    .map((line, index) => `${prefix(index)}${line}`)
    .join('\n');

  return {
    value: replaceRange(value, lineStart, lineEnd, replacement),
    selectionStart: lineStart,
    selectionEnd: lineStart + replacement.length,
  };
}

function editMarkdown(action: MarkdownAction, value: string, start: number, end: number): MarkdownEdit {
  switch (action) {
    case 'bold':
      return wrap(value, start, end, '**', '**');
    case 'italic':
      return wrap(value, start, end, '_', '_');
    case 'strike':
      return wrap(value, start, end, '~~', '~~');
    case 'bulletList':
      return prefixLines(value, start, end, () => '- ');
    case 'orderedList':
      return prefixLines(value, start, end, (index) => `${index + 1}. `);
    case 'taskList':
      return prefixLines(value, start, end, () => '- [ ] ');
    case 'quote':
      return prefixLines(value, start, end, () => '> ');
    case 'inlineCode':
      return wrap(value, start, end, '`', '`');
    case 'codeBlock':
      return wrap(value, start, end, '```\n', '\n```');
    case 'link': {
      const selected = value.slice(start, end);
      const replacement = `[${selected}](https://)`;
      const linkStart = start + selected.length + 3;
      return {
        value: replaceRange(value, start, end, replacement),
        selectionStart: selected ? linkStart : start + 1,
        selectionEnd: selected ? linkStart + 'https://'.length : start + 1,
      };
    }
  }
}

export function MarkdownToolbar({
  textareaRef,
  textareaId,
  label,
  value,
  onChange,
  disabled = false,
  className,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  textareaId?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { locale } = useI18n();
  const copy = locale === 'zh-CN' ? COPY['zh-CN'] : COPY['en-US'];
  const pendingSelection = useRef<MarkdownEdit | null>(null);

  useLayoutEffect(() => {
    const pending = pendingSelection.current;
    if (!pending || pending.value !== value) return;
    pendingSelection.current = null;
    const textarea = textareaRef.current;
    if (!textarea || disabled) return;
    textarea.focus();
    textarea.setSelectionRange(pending.selectionStart, pending.selectionEnd);
  }, [disabled, textareaRef, value]);

  const apply = (action: MarkdownAction) => {
    const textarea = textareaRef.current;
    if (!textarea || disabled) return;
    const edit = editMarkdown(action, value, textarea.selectionStart, textarea.selectionEnd);
    pendingSelection.current = edit;
    onChange(edit.value);
  };

  return (
    <div
      role="toolbar"
      aria-label={`${label} ${copy.toolbar}`}
      aria-controls={textareaId}
      className={cn(
        'flex min-h-9 max-w-full items-center gap-0.5 overflow-x-auto border-t border-border/70 bg-muted/20 px-1 py-1',
        className,
      )}
    >
      {ACTION_GROUPS.map((group, groupIndex) => (
        <Fragment key={group[0].action}>
          {groupIndex > 0 && <span role="separator" aria-orientation="vertical" className="mx-0.5 h-5 w-px shrink-0 bg-border" />}
          {group.map(({ action, icon: Icon }) => {
            const actionLabel = copy[action];
            return (
              <Tooltip key={action}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${label}${locale === 'zh-CN' ? '：' : ': '}${actionLabel}`}
                    disabled={disabled}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => apply(action)}
                    className="flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Icon aria-hidden="true" className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="z-[100]">{actionLabel}</TooltipContent>
              </Tooltip>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
