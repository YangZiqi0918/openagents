'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Paperclip, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { agentLabel } from '@/lib/helpers';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { useT } from '@/lib/i18n';

export function DraftChatView() {
  const { agents, currentUser, createAndSendSession } = useWorkspace();
  const { openView, setDraftThreadOpen } = useLayout();
  const t = useT();
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [participants, setParticipants] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const onlineAgents = agents.filter((agent) => agent.status === 'online');
  const onlineNames = onlineAgents.map((agent) => agent.agentName).join('|');

  useEffect(() => {
    setParticipants((current) => {
      const available = current.filter((name) => onlineAgents.some((agent) => agent.agentName === name));
      if (available.length) return available;
      const preferred = onlineAgents.find((agent) => agent.agentName === 'yumi') || onlineAgents[0];
      return preferred ? [preferred.agentName] : [];
    });
  // Reconcile only when online membership changes, not when a user edits the selection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineNames]);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  const send = async () => {
    if (sending || (!draft.trim() && files.length === 0) || !currentUser.name.trim()) return;
    setSending(true);
    try {
      await createAndSendSession({ content: draft.trim(), participants, files });
      setDraftThreadOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('draftThread.sendFailed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center">
        <h1 className="text-2xl font-semibold">{t('draftThread.title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('draftThread.subtitle')}</p>
      </div>
      <div className="mx-auto w-full max-w-4xl px-4 pb-5 lg:px-6">
        {onlineAgents.length === 0 && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <span>{t('newThread.noneOnline')}</span>
            <Button size="sm" variant="outline" onClick={() => { setDraftThreadOpen(false); openView('connect'); }}>{t('nav.connectAgent')}</Button>
          </div>
        )}
        <div className="rounded-lg border border-border bg-background shadow-sm focus-within:border-foreground/40">
          <label htmlFor="draft-chat-input" className="sr-only">{t('draftThread.message')}</label>
          <textarea
            id="draft-chat-input"
            ref={textareaRef}
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={t('draftThread.placeholder')}
            className="block min-h-24 max-h-52 w-full resize-y rounded-t-lg bg-transparent px-4 py-4 text-sm leading-6 outline-none placeholder:text-muted-foreground"
          />
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pb-2">
              {files.map((file, index) => (
                <span key={`${file.name}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded-md border border-border px-2 py-1 text-xs">
                  <Paperclip className="size-3 shrink-0" />
                  <span className="max-w-40 truncate">{file.name}</span>
                  <button type="button" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} aria-label={t('draftThread.removeFile')} title={t('draftThread.removeFile')}><X className="size-3" /></button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-border/60 px-2 py-2">
            <div className="flex min-w-0 items-center gap-1">
              <input ref={fileInputRef} type="file" multiple className="sr-only" aria-label={t('draftThread.attach')} onChange={(event) => { setFiles((current) => [...current, ...Array.from(event.target.files || [])]); event.target.value = ''; }} />
              <button type="button" onClick={() => fileInputRef.current?.click()} className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t('draftThread.attach')} title={t('draftThread.attach')}><Plus className="size-4" /></button>
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t('draftThread.agents')}>
                    <span className="truncate">{participants.map((name) => agentLabel(agents.find((agent) => agent.agentName === name) || { agentName: name } as typeof agents[number])).join(', ') || t('draftThread.agents')}</span>
                    <ChevronDown className="size-3 shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64">
                  <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{t('draftThread.agents')}</p>
                  {onlineAgents.length === 0 ? <p className="px-2 py-2 text-xs text-muted-foreground">{t('newThread.noneOnline')}</p> : onlineAgents.map((agent) => (
                    <label key={agent.agentName} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted">
                      <input type="checkbox" checked={participants.includes(agent.agentName)} onChange={(event) => setParticipants((current) => event.target.checked ? [...current, agent.agentName] : current.filter((name) => name !== agent.agentName))} className="size-4 accent-foreground" />
                      <AgentAvatar name={agent.agentName} size={18} />
                      <span className="truncate">{agentLabel(agent)}</span>
                    </label>
                  ))}
                </PopoverContent>
              </Popover>
            </div>
            <button type="button" onClick={() => void send()} disabled={sending || (!draft.trim() && files.length === 0) || !currentUser.name.trim()} className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40" aria-label={t('draftThread.send')} title={t('draftThread.send')}>
              {sending ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <ArrowUp className="size-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
