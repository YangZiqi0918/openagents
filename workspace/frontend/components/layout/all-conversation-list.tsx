'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, MessageSquare, Search, X } from 'lucide-react';
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { selectAllConversations } from '@/components/threads/thread-selectors';
import { useLayout } from './layout-context';
import { cn } from '@/lib/utils';

export function AllConversationList({ showLabels }: { showLabels: boolean }) {
  const { sessions, dmConversations, agents, currentSessionId, setCurrentSessionId } = useWorkspace();
  const { viewMode, draftThreadOpen, setDraftThreadOpen, openView } = useLayout();
  const t = useT();
  const [open, setOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!query.trim()) {
      setHits(new Set());
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      workspaceApi.searchMessages(query.trim())
        .then((results) => { if (!cancelled) setHits(new Set(results.map((hit) => hit.channelName))); })
        .catch(() => { if (!cancelled) setHits(new Set()); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const conversations = useMemo(() => {
    const all = selectAllConversations(sessions, dmConversations, agents, currentSessionId);
    if (!query.trim()) return all;
    const normalized = query.trim().toLowerCase();
    return all.filter((item) => item.title.toLowerCase().includes(normalized) || hits.has(item.id));
  }, [sessions, dmConversations, agents, currentSessionId, query, hits]);

  const select = (id: string) => {
    setDraftThreadOpen(false);
    setCurrentSessionId(id);
    openView('threads');
  };

  return (
    <SidebarGroup className="px-1.5">
      {showLabels ? (
        <div className="flex items-center gap-1">
          <SidebarGroupLabel asChild className="min-w-0 flex-1 cursor-pointer px-2">
            <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="all-conversation-list">
              <span className="truncate">{t('nav.allConversations')}</span>
              <ChevronDown className={cn('ml-auto size-4 shrink-0 transition-transform', !open && '-rotate-90')} aria-hidden="true" />
            </button>
          </SidebarGroupLabel>
          <button type="button" onClick={() => { setOpen(true); setSearchOpen((value) => !value); }} className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground" aria-label={t('threads.searchLabel')} title={t('threads.searchLabel')}><Search className="size-3.5" /></button>
        </div>
      ) : (
        <button type="button" onClick={() => openView('threads')} className="flex h-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent" aria-label={t('nav.allConversations')} title={t('nav.allConversations')}><MessageSquare className="size-4" /></button>
      )}
      {showLabels && open && (
        <SidebarGroupContent id="all-conversation-list">
          {searchOpen && (
            <div className="relative mb-1 px-1">
              <label htmlFor="all-conversation-search" className="sr-only">{t('threads.searchLabel')}</label>
              <input id="all-conversation-search" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); setSearchOpen(false); } }} placeholder={t('threads.searchPlaceholder')} className="h-8 w-full rounded-md border border-border bg-background pl-2 pr-8 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              <button type="button" onClick={() => { setQuery(''); setSearchOpen(false); }} className="absolute right-2 top-1 flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground" aria-label={t('threads.clearSearch')}><X className="size-3" /></button>
            </div>
          )}
          <SidebarMenu className="gap-0.5">
            {conversations.length === 0 && <li className="px-2 py-2 text-xs text-muted-foreground">{query ? t('threads.emptySearch') : t('threads.emptyAll')}</li>}
            {conversations.map((conversation) => (
              <SidebarMenuItem key={conversation.id}>
                <button type="button" onClick={() => select(conversation.id)} aria-current={viewMode === 'threads' && !draftThreadOpen && currentSessionId === conversation.id ? 'page' : undefined} title={conversation.title || t('threads.untitled')} className={cn('flex min-h-8 w-full min-w-0 items-center rounded-md px-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-ring', viewMode === 'threads' && !draftThreadOpen && currentSessionId === conversation.id ? 'bg-sidebar-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground')}>
                  <span className="block min-w-0 truncate">{conversation.title || t('threads.untitled')}</span>
                </button>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  );
}
