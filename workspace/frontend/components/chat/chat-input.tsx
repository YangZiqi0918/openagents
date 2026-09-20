'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ArrowUp, Paperclip, X, FileIcon, ImageIcon, Plus, CalendarClock } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { WorkspaceAgent, KnowledgeEntry, TeamMember } from '@/lib/types';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { agentLabel } from '@/lib/helpers';
import { BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '@/lib/i18n';

// Keep in sync with the backend's MAX_FILE_SIZE (app/config.py); nginx's
// /v1/files client_max_body_size allows extra headroom for multipart
// overhead. Oversized files would be rejected server-side anyway, so
// reject them here with immediate feedback instead.
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MENTION_CONTINUATION = new RegExp('[\\p{L}\\p{N}_-]', 'u');

export interface PendingFile {
  file: File;
  preview?: string; // data URL for images
}

export interface ProjectMentionConfig {
  agents: WorkspaceAgent[];
  participantNames: string[];
  members: TeamMember[] | null;
  membersError: boolean;
  onRetryMembers: () => void;
  workflowRunning?: boolean;
  activeWorkflowStepAgent?: string | null;
}

export interface SelectedMentionMetadata {
  selectedAgentNames: string[];
}

interface SelectedAgentToken {
  start: number;
  end: number;
  token: string;
  name: string;
}

interface MentionRange {
  start: number;
  end: number;
  filter: string;
}

function projectMentionRange(text: string, cursor: number, labels: string[]): MentionRange | null {
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf('@');
  if (at < 0 || (at > 0 && !/[\s([{]/.test(text[at - 1]))) return null;
  const filter = before.slice(at + 1);
  // Names may contain spaces. Keep the picker open while editing a display
  // name, but stop at another mention or a newline.
  if (filter.startsWith('{') || /[@\n\r]/.test(filter) || filter.length > 64) return null;
  if (/\s/.test(filter) && labels.length > 0 &&
      !labels.some((label) => label.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))) return null;

  const following = text.slice(cursor);
  let end = cursor + (following.match(/^[^\s@\n\r]*/)?.[0].length ?? 0);
  const remainder = text.slice(at + 1).toLocaleLowerCase();
  for (const label of labels) {
    if (label && remainder.startsWith(label.toLocaleLowerCase()) && at + 1 + label.length >= cursor) {
      end = Math.max(end, at + 1 + label.length);
    }
  }
  return { start: at, end, filter };
}

function updateSelectedTokens(tokens: SelectedAgentToken[], previous: string, next: string, edit?: { start: number; end: number }): SelectedAgentToken[] {
  if (previous === next) return tokens;
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (suffix < previous.length - prefix && suffix < next.length - prefix &&
         previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) suffix++;
  const knownEdit = edit && next.startsWith(previous.slice(0, edit.start)) &&
    next.endsWith(previous.slice(edit.end)) ? edit : null;
  const changedStart = knownEdit?.start ?? prefix;
  const changedEnd = knownEdit?.end ?? previous.length - suffix;
  const delta = next.length - previous.length;
  return tokens.flatMap((token) => {
    const shifted = changedEnd <= token.start
      ? { ...token, start: token.start + delta, end: token.end + delta }
      : changedStart >= token.end ? token : null;
    return shifted && next.slice(shifted.start, shifted.end) === shifted.token ? [shifted] : [];
  });
}

function selectedAgentNames(text: string, tokens: SelectedAgentToken[]): string[] {
  const seen = new Set<string>();
  return tokens.slice().sort((a, b) => a.start - b.start).flatMap((token) => {
    if (seen.has(token.name) || text.slice(token.start, token.end) !== token.token ||
        MENTION_CONTINUATION.test(text[token.end] ?? '')) return [];
    seen.add(token.name);
    return [token.name];
  });
}

type ProjectMentionItem =
  | { key: string; type: 'agent'; agent: WorkspaceAgent; joined: boolean }
  | { key: string; type: 'member'; member: TeamMember & { username: string } };

interface ChatInputProps {
  onSend: (content: string, mentions: string[], files: PendingFile[], metadata?: SelectedMentionMetadata) => void;
  disabled?: boolean;
  className?: string;
  agents?: WorkspaceAgent[];
  knowledge?: KnowledgeEntry[];
  draft?: string;
  onDraftChange?: (draft: string) => void;
  onFocusChange?: (focused: boolean) => void;
  /** Auto-focus the textarea when mounted or when this key changes. */
  focusKey?: number;
  onCreateRoutine?: () => void;
  /** Project-only candidate list; omitted for the unchanged personal/legacy picker. */
  projectMentions?: ProjectMentionConfig;
  /** Opens the project picker from a toolbar button, placing @ at the caret. */
  mentionTriggerKey?: number;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

const FILE_ACCEPT =
  'image/*,.pdf,.txt,.md,.json,.csv,.xml,.html,.css,.js,.ts,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.hpp,.sh,.yaml,.yml,.toml';

export function ChatInput({ onSend, disabled, className, agents = [], knowledge = [], draft, onDraftChange, onFocusChange, focusKey, onCreateRoutine, projectMentions, mentionTriggerKey }: ChatInputProps) {
  const { t, locale } = useI18n();
  const [message, setMessage] = React.useState(draft ?? '');
  const [showMentions, setShowMentions] = React.useState(false);
  const [mentionFilter, setMentionFilter] = React.useState('');
  const [mentionIndex, setMentionIndex] = React.useState(0);
  const [pendingFiles, setPendingFiles] = React.useState<PendingFile[]>([]);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isFocused, setIsFocused] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const dragCountRef = React.useRef(0);
  const messageRef = React.useRef(draft ?? '');
  const lastOwnDraftRef = React.useRef<string | null>(null);
  const selectedTokensRef = React.useRef<SelectedAgentToken[]>([]);
  const activeMentionRef = React.useRef<MentionRange | null>(null);
  const composingRef = React.useRef(false);
  const pendingEditRef = React.useRef<{ start: number; end: number } | null>(null);
  const mentionTriggerRef = React.useRef(mentionTriggerKey);
  const projectLabels = locale === 'zh-CN'
    ? { agents: '智能体', members: '项目成员', joining: '加入会话后参与', loading: '正在加载项目成员', retry: '成员加载失败，重试', empty: '没有匹配的成员或智能体', workflow: '运行中的工作流只能提及当前步骤智能体' }
    : { agents: 'Agents', members: 'Project members', joining: 'Joins the conversation', loading: 'Loading project members', retry: 'Members failed to load. Retry', empty: 'No matching agents or members', workflow: 'Only the current workflow step agent can be mentioned' };

  // Auto-size the textarea to its content (capped), toggling a scrollbar past
  // the cap. Centralized here so every path that changes `message` — typing,
  // mention insert, draft restore on thread switch, send-clear — resizes
  // consistently.
  const resizeTextarea = React.useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const capped = Math.min(ta.scrollHeight, 200);
    ta.style.height = `${capped}px`;
    ta.style.overflowY = ta.scrollHeight > 200 ? 'auto' : 'hidden';
  }, []);

  // Sync message state when draft prop changes (thread switch). Note: the draft
  // is controlled and round-trips on every keystroke, so this must NOT reset the
  // height itself — otherwise the box collapses to one row while typing. The
  // layout effect below handles sizing off `message`.
  React.useEffect(() => {
    const next = draft ?? '';
    if (lastOwnDraftRef.current !== next) selectedTokensRef.current = [];
    messageRef.current = next;
    setMessage(next);
  }, [draft]);

  // Keep the textarea sized to its content whenever the message changes.
  // useLayoutEffect runs synchronously before paint, so there's no flicker.
  React.useLayoutEffect(() => {
    resizeTextarea();
  }, [message, resizeTextarea]);

  // Auto-focus textarea when focusKey changes (thread opened/switched)
  React.useEffect(() => {
    if (focusKey != null && textareaRef.current) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [focusKey]);

  const agentNames = agents.map((a) => a.agentName);

  // Extract @mentions from message text
  const extractMentions = (text: string): string[] => {
    const matches = text.match(/@([\w-]+)/g) || [];
    return matches
      .map((m) => m.slice(1))
      .filter((name) => agentNames.includes(name));
  };

  // Only suggest online agents — mentioning offline ones never resolves and
  // just clutters the picker on long-lived workspaces. Filter matches either
  // the ASCII agent name or the user-set display name (e.g. typing "小" finds
  // the agent labeled "小明"); the inserted mention is always the agent name.
  const filteredAgents = agents.filter(
    (a) => a.status === 'online' && (
      a.agentName.toLowerCase().includes(mentionFilter.toLowerCase()) ||
      (a.displayName || '').toLowerCase().includes(mentionFilter.toLowerCase())
    )
  );

  const filteredKnowledge = knowledge.filter(
    (k) => k.title.toLowerCase().includes(mentionFilter.toLowerCase()) ||
           k.slug.toLowerCase().includes(mentionFilter.toLowerCase())
  );

  type MentionItem =
    | { type: 'agent'; agent: WorkspaceAgent }
    | { type: 'knowledge'; entry: KnowledgeEntry };

  const mentionItems: MentionItem[] = [
    ...filteredAgents.map((agent): MentionItem => ({ type: 'agent', agent })),
    ...filteredKnowledge.map((entry): MentionItem => ({ type: 'knowledge', entry })),
  ];

  const projectAgentNames = projectMentions?.agents.flatMap((agent) =>
    [agent.agentName, agent.displayName || '']) ?? [];
  const projectMemberNames = projectMentions?.members?.flatMap((member) =>
    [member.username || '', member.displayName || '']) ?? [];
  const projectSearch = mentionFilter.toLocaleLowerCase();
  const joinedAgents = new Set(projectMentions?.participantNames ?? []);
  const projectAgents = (projectMentions?.agents ?? [])
    .filter((agent) => agent.status === 'online' &&
      (!projectMentions?.workflowRunning || agent.agentName === projectMentions.activeWorkflowStepAgent) &&
      (agent.agentName.toLocaleLowerCase().includes(projectSearch) ||
       (agent.displayName || '').toLocaleLowerCase().includes(projectSearch)))
    .sort((left, right) => Number(joinedAgents.has(right.agentName)) - Number(joinedAgents.has(left.agentName)));
  const projectMembers = (projectMentions?.members ?? [])
    .filter((member): member is TeamMember & { username: string } => Boolean(member.username?.trim()))
    .filter((member) => member.username.toLocaleLowerCase().includes(projectSearch) ||
      (member.displayName || '').toLocaleLowerCase().includes(projectSearch));
  const projectItems: ProjectMentionItem[] = [
    ...projectAgents.map((agent) => ({ key: `agent:${agent.agentName}`, type: 'agent' as const, agent, joined: joinedAgents.has(agent.agentName) })),
    ...projectMembers.map((member) => ({ key: `member:${member.email}`, type: 'member' as const, member })),
  ];

  const publishMessage = (text: string, edit?: { start: number; end: number }) => {
    selectedTokensRef.current = updateSelectedTokens(selectedTokensRef.current, messageRef.current, text, edit);
    pendingEditRef.current = null;
    messageRef.current = text;
    lastOwnDraftRef.current = text;
    setMessage(text);
    onDraftChange?.(text);
  };

  const refreshProjectMention = (value: string, cursor: number) => {
    const range = projectMentionRange(value, cursor, [...projectAgentNames, ...projectMemberNames]);
    activeMentionRef.current = range;
    setMentionFilter(range?.filter ?? '');
    setMentionIndex(0);
    setShowMentions(Boolean(range));
  };

  React.useEffect(() => {
    if (!projectMentions || mentionTriggerKey == null || mentionTriggerRef.current === mentionTriggerKey || disabled) {
      mentionTriggerRef.current = mentionTriggerKey;
      return;
    }
    mentionTriggerRef.current = mentionTriggerKey;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const value = messageRef.current;
    const caret = textarea.selectionStart;
    const active = projectMentionRange(value, caret, [...projectAgentNames, ...projectMemberNames]);
    if (active) {
      refreshProjectMention(value, caret);
      textarea.focus();
      return;
    }
    const separator = caret > 0 && !/\s/.test(value[caret - 1]) ? ' ' : '';
    const inserted = `${separator}@`;
    const next = value.slice(0, caret) + inserted + value.slice(textarea.selectionEnd);
    publishMessage(next);
    const nextCaret = caret + inserted.length;
    refreshProjectMention(next, nextCaret);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
    // The trigger key, not the inline config object, determines when the toolbar opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionTriggerKey]);

  const addFiles = React.useCallback((files: FileList | File[]) => {
    const newFiles: PendingFile[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`"${file.name}" is too large (max 50MB)`);
        continue;
      }
      if (isImageFile(file)) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setPendingFiles((prev) => prev.map((pf) =>
            pf.file === file ? { ...pf, preview: e.target?.result as string } : pf
          ));
        };
        reader.readAsDataURL(file);
      }
      newFiles.push({ file });
    }
    setPendingFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const removeFile = (index: number) => {
    setPendingFiles((prev) => {
      const removed = prev[index];
      if (removed.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed && pendingFiles.length === 0) return;
    if (disabled) return;
    const mentions = extractMentions(trimmed);
    if (projectMentions) {
      onSend(trimmed, mentions, pendingFiles, {
        selectedAgentNames: selectedAgentNames(message, selectedTokensRef.current),
      });
    } else {
      onSend(trimmed, mentions, pendingFiles);
    }
    selectedTokensRef.current = [];
    activeMentionRef.current = null;
    messageRef.current = '';
    lastOwnDraftRef.current = '';
    setMessage('');
    onDraftChange?.('');
    setPendingFiles([]);
    setShowMentions(false);
    // Height resets via the layout effect when `message` becomes ''.
    textareaRef.current?.blur();
  };

  const insertMention = (mentionText: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBefore = message.slice(0, cursorPos);
    const textAfter = message.slice(cursorPos);

    const atIndex = textBefore.lastIndexOf('@');
    if (atIndex === -1) return;

    const newText = textBefore.slice(0, atIndex) + `@${mentionText} ` + textAfter;
    setMessage(newText);
    onDraftChange?.(newText);
    setShowMentions(false);
    setMentionFilter('');

    setTimeout(() => {
      textarea.focus();
      const newCursorPos = atIndex + mentionText.length + 2;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const insertMentionItem = (item: MentionItem) => {
    if (item.type === 'agent') {
      insertMention(item.agent.agentName);
    } else {
      insertMention(`knowledge:${item.entry.slug}`);
    }
  };

  const insertProjectMention = (item: ProjectMentionItem) => {
    const textarea = textareaRef.current;
    const value = messageRef.current;
    const range = activeMentionRef.current ?? (textarea && projectMentionRange(
      value, textarea.selectionStart, [...projectAgentNames, ...projectMemberNames]
    ));
    if (!textarea || !range) return;
    const name = item.type === 'agent' ? item.agent.agentName : item.member.username;
    const token = item.type === 'agent' ? `@${name}` :
      `@{${name.replaceAll('\\', '\\\\').replaceAll('}', '\\}').replaceAll('\n', '\\n').replaceAll('\r', '\\r')}}`;
    const after = value.slice(range.end);
    const separator = after && !/^\s/.test(after) ? ' ' : '';
    const next = value.slice(0, range.start) + token + separator + after;
    publishMessage(next);
    if (item.type === 'agent') {
      selectedTokensRef.current.push({ start: range.start, end: range.start + token.length, token, name });
    }
    activeMentionRef.current = null;
    setShowMentions(false);
    setMentionFilter('');
    requestAnimationFrame(() => {
      textarea.focus();
      const position = range.start + token.length + separator.length;
      textarea.setSelectionRange(position, position);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ignore Enter during IME composition (Chinese, Japanese, Korean input)
    if (composingRef.current || e.nativeEvent.isComposing || e.key === 'Process') return;

    if (projectMentions && showMentions) {
      if (e.key === 'ArrowDown' && projectItems.length > 0) {
        e.preventDefault();
        setMentionIndex((previous) => (previous + 1) % projectItems.length);
        return;
      }
      if (e.key === 'ArrowUp' && projectItems.length > 0) {
        e.preventDefault();
        setMentionIndex((previous) => (previous - 1 + projectItems.length) % projectItems.length);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && projectItems.length > 0) {
        e.preventDefault();
        insertProjectMention(projectItems[Math.min(mentionIndex, projectItems.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentions(false);
        return;
      }
    }

    if (!projectMentions && showMentions && mentionItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % mentionItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + mentionItems.length) % mentionItems.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMentionItem(mentionItems[mentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setShowMentions(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }

    // Escape blurs the textarea so global shortcuts (1-9, i, etc.) work again.
    if (e.key === 'Escape') {
      e.preventDefault();
      textareaRef.current?.blur();
    }
  };

  // Auto-resize textarea + detect @mentions
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (projectMentions) {
      publishMessage(value, pendingEditRef.current ?? undefined);
    }
    else {
      messageRef.current = value;
      lastOwnDraftRef.current = value;
      setMessage(value);
      onDraftChange?.(value);
    }
    const textarea = e.target;
    // Height is kept in sync by the layout effect keyed on `message`.

    // Detect @mention trigger
    const cursorPos = textarea.selectionStart;
    if (projectMentions) {
      if (composingRef.current || (e.nativeEvent as InputEvent).isComposing) {
        setShowMentions(false);
      } else {
        refreshProjectMention(value, cursorPos);
      }
      return;
    }
    const textBefore = value.slice(0, cursorPos);
    // [^\s@] (not \w) so typing a display name like "@小明" keeps the
    // picker open while filtering; the inserted mention is still ASCII.
    const atMatch = textBefore.match(/@([^\s@]*)$/);
    if (atMatch && (agents.length > 1 || knowledge.length > 0)) {
      setMentionFilter(atMatch[1]);
      setMentionIndex(0);
      setShowMentions(true);
    } else {
      setShowMentions(false);
    }
  };

  // Handle paste — detect images from clipboard
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      addFiles(imageFiles);
    }
  };

  // Drag-and-drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current--;
    if (dragCountRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current = 0;
    setIsDragging(false);

    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  /**
   * Opens the shared file input, optionally narrowed to one kind (images).
   * The accept list is restored afterwards so the next "Attach file" is not
   * stuck on the narrowed filter.
   */
  const openFilePicker = (accept?: string) => {
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = accept ?? FILE_ACCEPT;
    input.click();
    if (accept) {
      setTimeout(() => {
        if (fileInputRef.current) fileInputRef.current.accept = FILE_ACCEPT;
      }, 100);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = ''; // reset so same file can be selected again
    }
  };

  const hasContent = message.trim() || pendingFiles.length > 0;

  return (
    <div
      className={cn('relative', className)}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* @mention autocomplete dropdown */}
      {projectMentions && showMentions && (
        <div role="listbox" aria-label="@" className="absolute bottom-full mb-2 left-0 right-0 z-50 max-h-[280px] overflow-y-auto rounded-lg border bg-popover shadow-lg">
          {projectMentions.workflowRunning && (
            <div className="border-b px-3 py-2 text-xs text-muted-foreground">{projectLabels.workflow}</div>
          )}
          {projectAgents.length > 0 && (
            <div className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">{projectLabels.agents}</div>
          )}
          {projectItems.filter((item) => item.type === 'agent').map((item, idx) => {
            if (item.type !== 'agent') return null;
            return (
              <button
                key={item.key}
                type="button"
                role="option"
                aria-selected={idx === mentionIndex}
                className={cn('flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring', idx === mentionIndex && 'bg-accent')}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setMentionIndex(idx)}
                onClick={() => insertProjectMention(item)}
              >
                <AgentAvatar name={item.agent.agentName} size={24} status={item.agent.status} showStatus />
                <span className="min-w-0 flex-1 truncate">{agentLabel(item.agent)}</span>
                <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">@{item.agent.agentName}</span>
                {!item.joined && <span className="shrink-0 text-xs text-muted-foreground">{projectLabels.joining}</span>}
              </button>
            );
          })}
          {projectMembers.length > 0 && (
            <div className="border-y px-3 py-1.5 text-xs font-medium text-muted-foreground">{projectLabels.members}</div>
          )}
          {projectItems.map((item, idx) => {
            if (item.type !== 'member') return null;
            return (
              <button
                key={item.key}
                type="button"
                role="option"
                aria-selected={idx === mentionIndex}
                className={cn('flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring', idx === mentionIndex && 'bg-accent')}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setMentionIndex(idx)}
                onClick={() => insertProjectMention(item)}
              >
                <span className="min-w-0 flex-1 truncate">{item.member.displayName || item.member.username}</span>
                <span className="max-w-[50%] shrink-0 truncate text-xs text-muted-foreground">@{item.member.username}</span>
              </button>
            );
          })}
          {projectMentions.membersError ? (
            <button type="button" className="w-full px-3 py-2 text-left text-sm text-destructive hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              onMouseDown={(event) => event.preventDefault()} onClick={projectMentions.onRetryMembers}>{projectLabels.retry}</button>
          ) : projectMentions.members === null ? (
            <div role="status" className="px-3 py-2 text-xs text-muted-foreground">{projectLabels.loading}</div>
          ) : projectItems.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">{projectLabels.empty}</div>
          ) : null}
        </div>
      )}
      {!projectMentions && showMentions && mentionItems.length > 0 && (
        <div className="absolute bottom-full mb-2 left-0 right-0 bg-popover border rounded-lg shadow-lg z-50 overflow-hidden max-h-[280px] overflow-y-auto">
          {filteredAgents.length > 0 && filteredKnowledge.length > 0 && (
            <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b border-border">{t('chatInput.mentionAgents')}</div>
          )}
          {filteredAgents.map((agent) => {
            const idx = mentionItems.findIndex((m) => m.type === 'agent' && m.agent.agentName === agent.agentName);
            return (
              <button
                key={agent.agentName}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-accent transition-colors',
                  idx === mentionIndex && 'bg-accent'
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(agent.agentName);
                }}
              >
                <AgentAvatar name={agent.agentName} size={24} status={agent.status} showStatus />
                <span className="font-medium">{agentLabel(agent)}</span>
                {agentLabel(agent) !== agent.agentName && (
                  <span className="text-xs text-muted-foreground truncate">@{agent.agentName}</span>
                )}
                <span className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded-full ml-auto',
                  agent.role === 'master'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                )}>
                  {agent.role}
                </span>
                <span className={cn(
                  'size-2 rounded-full',
                  agent.status === 'online' ? 'bg-green-500' : 'bg-zinc-400'
                )} />
              </button>
            );
          })}
          {filteredKnowledge.length > 0 && (
            <>
              {filteredAgents.length > 0 && (
                <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-t border-border">{t('chatInput.mentionKnowledge')}</div>
              )}
              {filteredKnowledge.map((entry) => {
                const idx = mentionItems.findIndex((m) => m.type === 'knowledge' && m.entry.id === entry.id);
                return (
                  <button
                    key={entry.id}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-accent transition-colors',
                      idx === mentionIndex && 'bg-accent'
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(`knowledge:${entry.slug}`);
                    }}
                  >
                    <div className="size-6 rounded-md bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                      <BookOpen className="size-3.5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <span className="font-medium truncate">{entry.title}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto font-mono shrink-0">@knowledge:{entry.slug}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ChatGPT-style composer: one rounded bar with every control on a single
          row — the `+` menu on the left, the growing textarea in the middle and
          the send button on the right. Attachments stack above that row. */}
      <div className={cn(
        'relative flex flex-col gap-1.5 rounded-2xl border border-input bg-background px-2.5 py-2.5 shadow-xs transition-colors',
        isDragging && 'border-primary border-dashed bg-primary/5',
        isFocused && !isDragging && 'border-foreground/25 shadow-sm'
      )}>
        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl z-10 pointer-events-none">
            <span className="text-sm font-medium text-primary">{t('chatInput.dropFilesHere')}</span>
          </div>
        )}

        {/* Pending file previews */}
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1 pt-1">
            {pendingFiles.map((pf, i) => (
              <div
                key={i}
                className="relative group rounded-lg border bg-muted overflow-hidden"
              >
                {pf.preview ? (
                  <img
                    src={pf.preview}
                    alt={pf.file.name}
                    className="h-20 w-auto max-w-[160px] object-cover"
                  />
                ) : (
                  <div className="h-20 w-24 flex flex-col items-center justify-center gap-1 px-2">
                    <FileIcon className="size-5 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground truncate w-full text-center">
                      {pf.file.name}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => removeFile(i)}
                  className="absolute top-0.5 right-0.5 size-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-1">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={FILE_ACCEPT}
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Everything that isn't typing or sending lives behind the `+` */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                title={t('chatInput.addAttachments')}
                aria-label={t('chatInput.addAttachments')}
              >
                <Plus className="size-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="min-w-50">
              <DropdownMenuItem onSelect={() => openFilePicker()}>
                <Paperclip className="size-4" />
                {t('chatInput.attachFile')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openFilePicker('image/*')}>
                <ImageIcon className="size-4" />
                {t('chatInput.attachImage')}
              </DropdownMenuItem>
              {onCreateRoutine && (
                <DropdownMenuItem onSelect={() => onCreateRoutine()}>
                  <CalendarClock className="size-4" />
                  {t('chatInput.createRoutine')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleInput}
            onBeforeInput={(event) => {
              if (projectMentions) pendingEditRef.current = {
                start: event.currentTarget.selectionStart,
                end: event.currentTarget.selectionEnd,
              };
            }}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              if (projectMentions) { composingRef.current = true; setShowMentions(false); }
            }}
            onCompositionEnd={(event) => {
              if (projectMentions) {
                composingRef.current = false;
                refreshProjectMention(event.currentTarget.value, event.currentTarget.selectionStart);
              }
            }}
            onSelect={(event) => {
              if (projectMentions && showMentions && !composingRef.current) {
                refreshProjectMention(event.currentTarget.value, event.currentTarget.selectionStart);
              }
            }}
            onPaste={handlePaste}
            onFocus={() => { setIsFocused(true); onFocusChange?.(true); }}
            onBlur={() => { setIsFocused(false); onFocusChange?.(false); }}
            placeholder={projectMentions || agents.length > 1 || knowledge.length > 0 ? t('chatInput.placeholderWithMentions') : t('chatInput.placeholder')}
            rows={1}
            disabled={disabled}
            data-chat-input
            className="min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-2 text-sm shadow-none placeholder:text-muted-foreground focus:outline-none"
          />

          {/* Keyboard affordance for the global 'type anywhere' shortcut */}
          {isFocused ? (
            <kbd
              className="pointer-events-none mb-2.5 hidden h-4 shrink-0 items-center justify-center rounded border border-input bg-muted px-1 font-mono text-[9px] font-medium text-muted-foreground sm:flex"
              title={t('chatInput.escHint')}
            >
              esc
            </kbd>
          ) : !message ? (
            <kbd
              className="pointer-events-none mb-2.5 hidden size-4 shrink-0 items-center justify-center rounded border border-input bg-muted font-mono text-[9px] font-medium text-muted-foreground sm:flex"
              title={t('chatInput.typeHint')}
            >
              i
            </kbd>
          ) : null}

          <Button
            variant={hasContent ? 'primary' : 'secondary'}
            size="icon"
            className={cn(
              'mb-0.5 size-8 shrink-0 rounded-full transition-all',
              hasContent ? 'opacity-100' : 'opacity-50'
            )}
            onClick={handleSend}
            disabled={!hasContent || disabled}
            aria-label={t('chatInput.sendMessage')}
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
