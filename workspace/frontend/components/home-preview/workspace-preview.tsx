'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Archive, ArchiveRestore, ArrowUp, BookOpen, CalendarClock, ChevronDown,
  FolderKanban, Inbox, Menu, MessageSquare, MoreHorizontal,
  Plus, Search, Sparkles, SquarePen, X,
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useConfirm, usePrompt } from '@/components/ui/dialogs-provider';
import { ProjectsView } from '@/components/project/projects-view';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type View = 'threads' | 'projects' | 'routines' | 'knowledge' | 'inbox' | 'skills';
type DemoThread = { id: string; title: string; messages: string[]; starred: boolean; archived: boolean };

const INITIAL_THREADS: DemoThread[] = [
  { id: 'demo-1', title: '梳理服务器部署配置', messages: ['帮我梳理服务器部署配置。'], starred: false, archived: false },
  { id: 'demo-2', title: '安装 Linux 输入法', messages: ['整理安装 Linux 输入法时需要检查的步骤。'], starred: false, archived: false },
  { id: 'demo-3', title: '查询 OpenAgents 最近更新', messages: ['帮我列出需要核对的近期更新。'], starred: false, archived: false },
  { id: 'demo-4', title: '与 yumi 的私聊', messages: ['你好，yumi。'], starred: false, archived: false },
  { id: 'demo-5', title: '上周工作回顾', messages: ['整理上周完成的工作。'], starred: false, archived: true },
];

const NAV = [
  { id: 'projects', label: '项目', icon: FolderKanban },
  { id: 'routines', label: '定时任务', icon: CalendarClock },
  { id: 'knowledge', label: '知识库', icon: BookOpen },
  { id: 'inbox', label: '收件箱', icon: Inbox },
  { id: 'skills', label: '技能中心', icon: Sparkles },
] as const;

export function WorkspacePreview() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>('threads');
  const [threads, setThreads] = useState<DemoThread[]>(INITIAL_THREADS);
  const [selectedId, setSelectedId] = useState<string | null>('demo-1');
  const [draftOpen, setDraftOpen] = useState(false);
  const [threadsOpen, setThreadsOpen] = useState(true);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [agent, setAgent] = useState('yumi');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const menuRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();
  const prompt = usePrompt();
  const confirm = useConfirm();

  useEffect(() => setReady(true), []);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false);
        requestAnimationFrame(() => menuRef.current?.focus());
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  const selected = threads.find((thread) => thread.id === selectedId) || null;
  const visibleThreads = threads.filter((thread) => thread.title.toLowerCase().includes(query.toLowerCase()));

  const navigate = (next: View) => { setView(next); setMobileOpen(false); };
  const openDraft = () => {
    setDraftOpen(true);
    setSelectedId(null);
    setThreadsOpen(true);
    setView('threads');
    setMobileOpen(false);
    setMessage('');
    setNotice('');
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const selectThread = (id: string) => {
    setSelectedId(id);
    setDraftOpen(false);
    setView('threads');
    setMobileOpen(false);
    setNotice('');
  };
  const updateSelected = (changes: Partial<DemoThread>) => {
    if (!selected) return;
    setThreads((current) => current.map((thread) => thread.id === selected.id ? { ...thread, ...changes } : thread));
  };
  const send = () => {
    const text = message.trim();
    if (!text) return;
    if (draftOpen || !selected) {
      const thread: DemoThread = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: text.split('\n')[0].slice(0, 60), messages: [text], starred: false, archived: false,
      };
      setThreads((current) => [thread, ...current]);
      setSelectedId(thread.id);
      setDraftOpen(false);
    } else updateSelected({ messages: [...selected.messages, text] });
    setMessage('');
    setNotice('本地预览，消息没有发送给智能体');
  };
  const remove = async () => {
    if (!selected) return;
    const ok = await confirm({ title: '删除会话', description: `确定删除“${selected.title}”吗？`, confirmText: '删除', destructive: true });
    if (!ok) return;
    setThreads((current) => current.filter((thread) => thread.id !== selected.id));
    openDraft();
  };
  const rename = async () => {
    if (!selected) return;
    const next = await prompt({ title: '重命名会话', defaultValue: selected.title, confirmText: '重命名' });
    if (next?.trim()) updateSelected({ title: next.trim() });
  };

  return (
    <div className="grid min-h-[100dvh] grid-cols-1 bg-background text-foreground lg:h-[100dvh] lg:grid-cols-[264px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
      {mobileOpen && <button type="button" className="fixed inset-0 z-40 bg-zinc-950/30 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="关闭导航" />}
      <aside id="preview-sidebar" inert={isMobile && !mobileOpen} aria-hidden={isMobile && !mobileOpen} className={`fixed inset-y-0 left-0 z-50 flex w-[min(280px,calc(100vw-48px))] flex-col border-r border-border bg-zinc-50 transition-transform duration-200 dark:bg-zinc-950 lg:static lg:h-full lg:w-[264px] lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-16 shrink-0 items-center justify-between px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <img src="/logo-icon.png" alt="" className="size-7 object-contain dark:hidden" />
            <img src="/logo-white.png" alt="" className="hidden size-7 object-contain dark:block" />
            <span className="truncate text-[15px] font-semibold">OpenAgents</span>
          </div>
          <button type="button" onClick={() => setMobileOpen(false)} className="rounded-md p-2 text-muted-foreground hover:bg-muted lg:hidden" aria-label="关闭侧栏"><X className="size-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-5">
          <p className="px-3 pb-3 text-[11px] font-medium text-muted-foreground">协作</p>
          <button type="button" onClick={openDraft} aria-current={view === 'threads' && draftOpen ? 'page' : undefined} className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm ${view === 'threads' && draftOpen ? 'bg-zinc-200/70 font-medium dark:bg-zinc-800' : 'text-muted-foreground hover:bg-zinc-200/50 hover:text-foreground dark:hover:bg-zinc-900'}`}>
            <SquarePen className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />新对话
          </button>
          <nav className="mt-1 space-y-1" aria-label="其他导航">
            {NAV.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => navigate(id)} aria-current={view === id ? 'page' : undefined} className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm ${view === id ? 'bg-zinc-200/70 font-medium dark:bg-zinc-800' : 'text-muted-foreground hover:bg-zinc-200/50 hover:text-foreground dark:hover:bg-zinc-900'}`}><Icon className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />{label}</button>)}
          </nav>
          <div className="mt-7 border-t border-border pt-4">
            <button type="button" onClick={() => setAgentsOpen((open) => !open)} aria-expanded={agentsOpen} aria-controls="preview-agents" className="flex h-9 w-full items-center justify-between rounded-md px-3 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"><span>智能体 (2)</span><ChevronDown className={`size-4 transition-transform ${agentsOpen ? '' : '-rotate-90'}`} /></button>
            {agentsOpen && <div id="preview-agents" className="space-y-0.5 pt-1">{['yumi', 'Codex'].map((name) => <button key={name} type="button" onClick={() => { setAgent(name); navigate('threads'); }} className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-muted"><span className="size-2 rounded-full bg-emerald-500" />{name}</button>)}</div>}
          </div>
          <div className="mt-4 border-t border-border pt-3">
            <div className="flex h-9 items-center gap-1">
              <button type="button" onClick={() => setThreadsOpen((open) => !open)} aria-expanded={threadsOpen} aria-controls="preview-thread-list" className="flex min-w-0 flex-1 items-center justify-between rounded-md px-3 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                <span>全部会话</span><ChevronDown className={`size-4 shrink-0 transition-transform ${threadsOpen ? '' : '-rotate-90'}`} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => { setThreadsOpen(true); setSearchOpen((open) => !open); }} className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="搜索会话" title="搜索会话"><Search className="size-3.5" /></button>
            </div>
            {threadsOpen && (
              <div id="preview-thread-list" className="mt-1 px-1">
                {searchOpen && <div className="relative mb-2"><label htmlFor="preview-search" className="sr-only">搜索会话标题</label><input id="preview-search" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setSearchOpen(false); setQuery(''); } }} placeholder="搜索会话标题" className="h-8 w-full rounded-md border border-border bg-background px-2 pr-7 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" /><button type="button" onClick={() => { setQuery(''); setSearchOpen(false); }} className="absolute right-1 top-1 flex size-6 items-center justify-center text-muted-foreground" aria-label="关闭搜索"><X className="size-3" /></button></div>}
                {visibleThreads.length === 0 ? <p className="px-2 py-3 text-xs text-muted-foreground">{query ? '没有匹配的会话' : '还没有会话'}</p> : visibleThreads.map((thread) => (
                  <button key={thread.id} type="button" onClick={() => selectThread(thread.id)} title={thread.title} aria-current={view === 'threads' && !draftOpen && selectedId === thread.id ? 'page' : undefined} className={`flex min-h-9 w-full items-center rounded-md px-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-ring ${view === 'threads' && !draftOpen && selectedId === thread.id ? 'bg-zinc-200/70 font-medium dark:bg-zinc-800' : 'text-muted-foreground hover:bg-zinc-200/50 hover:text-foreground dark:hover:bg-zinc-900'}`}><span className="truncate">{thread.title}</span></button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="shrink-0 border-t border-border px-3 py-3"><a href="/legacy-home?projects=1" className="flex h-9 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"><Plus className="size-4" />旧版工作区</a><p className="px-3 pt-2 text-xs text-muted-foreground">原型预览</p></div>
      </aside>

      {!ready ? <div className="min-h-[100dvh] p-8" role="status" aria-label="正在加载页面"><div className="h-6 w-36 animate-pulse rounded bg-muted" /><div className="mt-8 h-28 animate-pulse rounded bg-muted" /></div> : (
        <main className="flex min-h-[100dvh] min-w-0 flex-col bg-background lg:h-full lg:min-h-0 lg:overflow-hidden">
          {view === 'projects' ? (
            <button ref={menuRef} type="button" onClick={() => setMobileOpen(true)} className="fixed left-4 top-3 z-30 flex size-8 items-center justify-center rounded-md hover:bg-muted lg:hidden" aria-label="打开导航"><Menu className="size-4" /></button>
          ) : <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-2.5"><button ref={menuRef} type="button" onClick={() => setMobileOpen(true)} className="flex size-8 items-center justify-center rounded-md hover:bg-muted lg:hidden" aria-label="打开导航"><Menu className="size-4" /></button><MessageSquare className="hidden size-4 text-muted-foreground sm:block" aria-hidden="true" /><h1 className="truncate text-sm font-semibold">{view === 'threads' ? draftOpen ? '新对话' : selected?.title || 'yumi' : NAV.find((item) => item.id === view)?.label}</h1></div>
            <div className="flex items-center gap-2"><span className="hidden rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300 sm:inline-flex">原型预览</span>{view === 'threads' && selected && !draftOpen && <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" aria-label="会话操作" title="会话操作"><MoreHorizontal className="size-4" /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => void rename()}>重命名</DropdownMenuItem><DropdownMenuItem onClick={() => updateSelected({ starred: !selected.starred })}>{selected.starred ? '取消星标' : '星标'}</DropdownMenuItem><DropdownMenuItem onClick={() => updateSelected({ archived: !selected.archived })}>{selected.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}{selected.archived ? '恢复会话' : '归档会话'}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => void remove()} className="text-destructive">删除</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</div>
          </header>}
          {view === 'projects' ? <ProjectsView /> : view === 'threads' ? <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:px-10"><div className="mx-auto max-w-3xl">
              {draftOpen ? <div className="flex h-full min-h-[220px] flex-col items-center justify-center text-center"><h2 className="text-2xl font-semibold">新对话</h2><p className="mt-2 text-sm text-muted-foreground">发送第一条消息后才会加入左侧会话列表。</p></div>
                : selected ? <div className="space-y-6">{selected.messages.map((text, index) => <div key={index} className="ml-auto max-w-[min(100%,620px)] rounded-md bg-muted/70 px-4 py-3 text-sm leading-7"><p className="whitespace-pre-wrap break-words">{text}</p></div>)}<p className="text-xs text-muted-foreground">本地预览，消息没有发送给智能体</p></div>
                : <div className="flex items-start gap-4"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><Sparkles className="size-5" /></span><div className="space-y-3 text-sm leading-7"><p className="font-semibold">yumi <span className="ml-2 text-xs font-normal text-muted-foreground">示例</span></p><p>你好，我是你的工作区向导。可以在左侧新建会话，或者直接从下面的输入框开始。</p></div></div>}
            </div></div>
            <div className="mx-auto w-full max-w-4xl px-4 pb-5 sm:px-8"><div className="rounded-lg border border-border bg-background shadow-sm focus-within:border-foreground/40"><label htmlFor="preview-composer" className="sr-only">发送消息</label><textarea id="preview-composer" ref={inputRef} rows={2} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} placeholder="发送消息...（本地预览）" className="block min-h-20 w-full resize-y rounded-t-lg bg-transparent px-4 py-4 text-sm outline-none placeholder:text-muted-foreground" /><div className="flex items-center justify-between border-t border-border/60 px-3 py-2"><select value={agent} onChange={(event) => setAgent(event.target.value)} className="h-8 max-w-40 rounded-md bg-background px-2 text-xs text-muted-foreground" aria-label="选择智能体"><option value="yumi">yumi</option><option value="Codex">Codex</option></select><button type="button" onClick={send} disabled={!message.trim()} className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-40" aria-label="添加本地消息" title="添加本地消息"><ArrowUp className="size-4" /></button></div></div>{notice && <p className="mt-2 text-center text-xs text-muted-foreground" role="status">{notice}</p>}</div>
          </> : <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 py-10 sm:px-10"><p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">个人空间 · 原型预览</p><h2 className="mt-2 border-b border-border pb-6 text-2xl font-semibold">{NAV.find((item) => item.id === view)?.label}</h2><div className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground"><p className="text-sm">暂无内容</p></div></div>}
        </main>
      )}
    </div>
  );
}
