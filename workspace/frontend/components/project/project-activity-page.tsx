'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  Copy,
  Crown,
  Loader2,
  MessageSquare,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  Users,
} from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useWorkspaceApi } from '@/lib/workspace-api-context';
import { useI18n } from '@/lib/i18n';
import { useIsMobile } from '@/hooks/use-mobile';
import { agentLabel } from '@/lib/helpers';
import { projectShareUrl } from '@/lib/project-channels';
import { shareOrigin } from '@/lib/share-origin';
import { IS_LOCAL_AUTH } from '@/lib/api-config';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { OrchestrationControl } from '@/components/chat/orchestration-control';
import type { TeamMember } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/dialogs-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '@/components/ui/responsive-dialog';
import { activityLabels } from './project-activity-model';
import { useProjectActivity } from './use-project-activity';
import {
  ProjectActivityConversation,
  type ActivitySend,
} from './project-activity-conversation';

interface ProjectActivityPageProps {
  projectId: string;
  projectName: string;
  initialSessionId?: string;
}

const iconClass =
  'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40';

export function ProjectActivityPage(props: ProjectActivityPageProps) {
  const { workspace, currentUser } = useWorkspace();
  if (!workspace)
    return (
      <div role="status" className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  return (
    <ActivityContent
      key={`${workspace.workspaceId}:${props.projectId}:${currentUser.id}`}
      {...props}
      workspaceId={workspace.workspaceId}
    />
  );
}

function ActivityContent({
  projectId,
  projectName,
  initialSessionId,
  workspaceId,
}: ProjectActivityPageProps & { workspaceId: string }) {
  const { agents, currentUser, me } = useWorkspace();
  const workspaceApi = useWorkspaceApi();
  const { locale } = useI18n();
  const l = activityLabels(locale);
  const isMobile = useIsMobile();
  const confirm = useConfirm();
  const activity = useProjectActivity(
    workspaceId,
    projectId,
    currentUser.id,
    initialSessionId,
  );
  const appliedLink = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (initialSessionId && appliedLink.current !== initialSessionId &&
      activity.sessions.some((session) => session.sessionId === initialSessionId)) {
      appliedLink.current = initialSessionId;
      activity.select(initialSessionId);
      setPane('detail');
    }
  }, [initialSessionId, activity.sessions]); // eslint-disable-line react-hooks/exhaustive-deps
  const [humanMembers, setHumanMembers] = useState<TeamMember[] | null>(null);
  const [membersError, setMembersError] = useState(false);
  const loadMembers = () => {
    if (!IS_LOCAL_AUTH) return;
    setMembersError(false);
    void workspaceApi.getTeam().then(setHumanMembers).catch(() => setMembersError(true));
  };
  useEffect(() => {
    loadMembers();
  }, [workspaceApi]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pane, setPane] = useState<'list' | 'detail'>(
    initialSessionId ? 'detail' : 'list',
  );
  const [form, setForm] = useState<{ id?: string; name: string; participants: string[] } | null>(null);
  const [sending, setSending] = useState(false);
  const [failedSends, setFailedSends] = useState<
    Record<string, ActivitySend | undefined>
  >({});
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const selected = activity.sessions.find(
    (session) => session.sessionId === activity.preferences.selectedId,
  );
  const disabled = activity.busy || sending;
  const readOnly = IS_LOCAL_AUTH && !['owner', 'admin', 'member'].includes(me?.role || '');
  const onlineAgents = agents.filter((agent) => agent.status === 'online');
  const newConversation = () => setForm({
    name: '',
    participants: onlineAgents.length === 1 && !onlineAgents[0].builtin
      ? [onlineAgents[0].agentName]
      : [],
  });
  const shareUrl = projectShareUrl(shareOrigin(), workspaceId, {
    projectId,
    projectName,
    sessionId: selected?.sessionId,
  });
  const participantNames = Array.from(
    new Set([
      ...agents.map((agent) => agent.agentName),
      ...(selected?.participants || []),
    ]),
  );

  const deleteConversation = async (id: string) => {
    if (disabled || readOnly) return;
    if (
      !(await confirm({
        title: l.delete,
        description: l.deleteDescription,
        confirmText: l.delete,
        destructive: true,
      }))
    )
      return;
    if (await activity.remove(id))
      setFailedSends((previous) => ({ ...previous, [id]: undefined }));
  };

  const saveConversation = async () => {
    if (readOnly || !form?.name.trim() || form.name.trim().length > 60) return;
    const success = form.id
      ? await activity.rename(form.id, form.name.trim())
      : await activity.create(form.name.trim(), form.participants.filter((name) =>
          onlineAgents.some((agent) => agent.agentName === name)));
    if (success) {
      setForm(null);
      setPane('detail');
    }
  };

  return (
    <div
      data-testid="project-activity-page"
      data-project-id={projectId}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
    >
      {(activity.loadError ||
        activity.operationError ||
        activity.storageFailed) && (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-sm"
        >
          <span className="min-w-0 flex-1 break-words">
            {activity.loadError
              ? l.loadFailed
              : activity.operationError
                ? `${l.operationFailed} (${activity.operationError})`
                : l.storageFailed}
          </span>
          {activity.loadError && (
            <button
              type="button"
              title={l.retry}
              aria-label={l.retry}
              onClick={() => void activity.refresh()}
              className={iconClass}
            >
              <RefreshCw className="size-4" />
            </button>
          )}
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {(!isMobile || pane === 'list' || !selected) && (
          <aside
            data-testid="project-activity-list"
            aria-label={l.conversations}
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r border-border lg:w-[320px] lg:flex-none"
          >
            <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
                {l.conversations}
              </h2>
              <button
                type="button"
                title={l.share}
                aria-label={l.share}
                onClick={() => {
                  setCopied(false);
                  setCopyError(false);
                  setShareOpen(true);
                }}
                className={iconClass}
              >
                <Share2 className="size-4" />
              </button>
              <button
                type="button"
                title={l.refresh}
                aria-label={l.refresh}
                disabled={disabled}
                onClick={() => void activity.refresh()}
                className={iconClass}
              >
                <RefreshCw className="size-4" />
              </button>
              <button
                type="button"
                title={l.newConversation}
                aria-label={l.newConversation}
                disabled={disabled || readOnly}
                onClick={newConversation}
                className={iconClass}
              >
                <Plus className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {activity.loading ? (
                <div
                  role="status"
                  aria-label={l.loading}
                  className="space-y-3 p-2"
                >
                  {[0, 1, 2].map((index) => (
                    <div
                      key={index}
                      className="h-14 rounded-md bg-muted motion-safe:animate-pulse"
                    />
                  ))}
                </div>
              ) : !activity.sessions.length ? (
                <div className="flex flex-col items-center gap-3 px-3 py-12 text-center text-muted-foreground">
                  <MessageSquare className="size-7 opacity-40" />
                  <p className="text-sm">{l.empty}</p>
                  <Button
                    variant="outline"
                    disabled={disabled || readOnly}
                    onClick={newConversation}
                  >
                    <Plus className="size-4" />
                    {l.newConversation}
                  </Button>
                </div>
              ) : (
                activity.sessions.map((session) => {
                  const unread =
                    (session.lastEventAt || 0) >
                    (activity.preferences.readAt[session.sessionId] || 0);
                  return (
                    <div
                      key={session.sessionId}
                      data-testid="project-activity-row"
                      className={`group flex min-w-0 items-center rounded-md border ${selected?.sessionId === session.sessionId ? 'border-border bg-muted/60' : 'border-transparent hover:bg-muted/40'}`}
                    >
                      <button
                        type="button"
                        disabled={disabled}
                        aria-pressed={selected?.sessionId === session.sessionId}
                        onClick={() => {
                          activity.select(session.sessionId);
                          setPane('detail');
                        }}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
                      >
                        <MessageSquare className="size-5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate text-sm ${unread ? 'font-semibold' : 'font-medium'}`}
                          >
                            {session.title}
                          </span>
                          <span className="mt-1 block truncate text-xs text-muted-foreground">
                            {session.participants
                              .map((name) =>
                                agentLabel(
                                  agents.find(
                                    (agent) => agent.agentName === name,
                                  ) ||
                                    ({
                                      agentName: name,
                                    } as (typeof agents)[number]),
                                ),
                              )
                              .join(', ') || projectName}
                          </span>
                        </span>
                        {unread && (
                          <span className="size-1.5 shrink-0 rounded-full bg-foreground" />
                        )}
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={`${l.title}: ${session.title}`}
                            title={session.title}
                            disabled={disabled || readOnly}
                            className={`${iconClass} mr-1`}
                          >
                            <MoreVertical className="size-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              setForm({
                                id: session.sessionId,
                                name: session.title,
                                participants: [],
                              })
                            }
                          >
                            <Pencil className="size-4" />
                            {l.rename}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() =>
                              void deleteConversation(session.sessionId)
                            }
                          >
                            <Trash2 className="size-4" />
                            {l.delete}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        )}
        {(!isMobile || (pane === 'detail' && selected)) && (
          <section
            data-testid="project-activity-detail"
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          >
            {selected ? (
              <>
                <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 lg:px-5">
                  {isMobile && (
                    <button
                      type="button"
                      title={l.back}
                      aria-label={l.back}
                      disabled={sending}
                      onClick={() => setPane('list')}
                      className={iconClass}
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                  )}
                  <h2
                    className="min-w-0 flex-1 truncate text-sm font-semibold"
                    title={selected.title}
                  >
                    {selected.title}
                  </h2>
                  {selected.participants.length > 0 && !readOnly && (
                    <>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" title={l.leader} aria-label={l.leader} className={iconClass} disabled={disabled}>
                            <Crown className="size-4" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-64 p-2">
                          <h3 className="px-2 pb-1 text-sm font-medium">{l.leader}</h3>
                          {selected.participants.map((name) => (
                            <button key={name} type="button" disabled={disabled}
                              className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                              onClick={() => void activity.configure(selected.sessionId, { master: name })}>
                              <AgentAvatar name={name} size={20} />
                              <span className="min-w-0 flex-1 truncate">{agents.find((agent) => agent.agentName === name)?.displayName || name}</span>
                              {selected.master === name && <Check className="size-4" />}
                            </button>
                          ))}
                        </PopoverContent>
                      </Popover>
                      {agents.filter((agent) => selected.participants.includes(agent.agentName)).length >= 2 && (
                        <OrchestrationControl session={selected}
                          agents={agents.filter((agent) => selected.participants.includes(agent.agentName))}
                          onChange={(changes) => void activity.configure(selected.sessionId, changes)} />
                      )}
                    </>
                  )}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        title={l.participants}
                        aria-label={l.participants}
                        className={iconClass}
                      >
                        <Users className="size-4" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="max-h-80 w-64 overflow-y-auto p-3"
                    >
                      <h3 className="mb-2 text-sm font-medium">
                        {l.participants}
                      </h3>
                      {!participantNames.length && (
                        <p className="py-2 text-sm text-muted-foreground">
                          {l.noAgents}
                        </p>
                      )}
                      {participantNames.map((name) => {
                        const agent = agents.find(
                          (item) => item.agentName === name,
                        );
                        const included = selected.participants.includes(name);
                        return (
                          <label
                            key={name}
                            className="flex items-center gap-3 rounded-sm px-2 py-2 hover:bg-muted"
                          >
                            <input
                              type="checkbox"
                              checked={included}
                              disabled={
                                disabled || readOnly ||
                                (!included && agent?.status !== 'online')
                              }
                              onChange={() =>
                                void activity.participant(
                                  selected.sessionId,
                                  name,
                                  !included,
                                )
                              }
                              className="size-4 shrink-0 accent-foreground"
                            />
                            <AgentAvatar name={name} size={24} />
                            <span className="min-w-0 flex-1 truncate text-sm">
                              {agent ? agentLabel(agent) : name}
                            </span>
                            {agent?.status !== 'online' && (
                              <span className="text-xs text-muted-foreground">
                                {l.offline}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </PopoverContent>
                  </Popover>
                  <button
                    type="button"
                    title={l.share}
                    aria-label={l.share}
                    onClick={() => {
                      setCopied(false);
                      setCopyError(false);
                      setShareOpen(true);
                    }}
                    className={iconClass}
                  >
                    <Share2 className="size-4" />
                  </button>
                </div>
                {selected.participants.length > 0 && (
                  <div className="flex shrink-0 items-center gap-4 overflow-x-auto border-b border-border px-4 py-2">
                    {selected.participants.map((name) => (
                      <span
                        key={name}
                        className="flex shrink-0 items-center gap-2 text-xs"
                      >
                        <AgentAvatar name={name} size={18} />
                        <span>
                          {agents.find((agent) => agent.agentName === name)
                            ? agentLabel(
                                agents.find(
                                  (agent) => agent.agentName === name,
                                )!,
                              )
                            : name}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
                <ProjectActivityConversation
                  key={selected.sessionId}
                  workspaceId={workspaceId}
                  sessionId={selected.sessionId}
                  agents={agents.filter((agent) =>
                    selected.participants.includes(agent.agentName),
                  )}
                  currentUser={currentUser}
                  humanMembers={humanMembers?.filter((member) => member.username && member.username !== me?.username) || null}
                  membersError={membersError}
                  onRetryMembers={loadMembers}
                  readOnly={readOnly}
                  draft={activity.preferences.drafts[selected.sessionId] || ''}
                  onDraftChange={(text) =>
                    activity.draft(selected.sessionId, text)
                  }
                  onRead={() => activity.markRead(selected.sessionId)}
                  onSending={setSending}
                  failedSend={failedSends[selected.sessionId]}
                  onFailedSend={(send) =>
                    setFailedSends((previous) => ({
                      ...previous,
                      [selected.sessionId]: send,
                    }))
                  }
                  labels={l}
                />
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
                <MessageSquare className="size-7 opacity-40" />
                <p className="text-sm">{l.select}</p>
              </div>
            )}
          </section>
        )}
      </div>
      <Dialog
        open={form !== null}
        onOpenChange={(open) => {
          if (!open && !activity.busy) setForm(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveConversation();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {form?.id ? l.rename : l.newConversation}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {l.title}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <label
                htmlFor="activity-conversation-name"
                className="mb-2 block text-sm font-medium"
              >
                {l.title}
              </label>
              <Input
                id="activity-conversation-name"
                autoFocus
                required
                maxLength={60}
                value={form?.name || ''}
                disabled={activity.busy}
                onChange={(event) =>
                  setForm((previous) =>
                    previous ? { ...previous, name: event.target.value } : null,
                  )
                }
              />
              {activity.operationError && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {l.operationFailed} ({activity.operationError})
                </p>
              )}
              {!form?.id && (
                <div className="mt-4 space-y-2">
                  <p className="text-sm font-medium">{l.chooseAgents}</p>
                  {onlineAgents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{l.noOnlineAgents}</p>
                  ) : onlineAgents.map((agent) => (
                    <label key={agent.agentName} className="flex cursor-pointer items-center gap-3 rounded-sm px-2 py-2 hover:bg-muted">
                      <input type="checkbox" className="size-4 accent-foreground" disabled={activity.busy}
                        checked={Boolean(form?.participants.includes(agent.agentName))}
                        onChange={(event) => setForm((previous) => previous ? {
                          ...previous,
                          participants: event.target.checked
                            ? [...previous.participants, agent.agentName]
                            : previous.participants.filter((name) => name !== agent.agentName),
                        } : null)} />
                      <AgentAvatar name={agent.agentName} size={24} />
                      <span className="min-w-0 flex-1 truncate text-sm">{agentLabel(agent)}</span>
                    </label>
                  ))}
                </div>
              )}
            </DialogBody>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={activity.busy}
                onClick={() => setForm(null)}
              >
                {l.cancel}
              </Button>
              <Button
                type="submit"
                disabled={activity.busy || !form?.name.trim()}
              >
                {activity.busy && <Loader2 className="size-4 animate-spin" />}
                {form?.id ? l.save : l.create}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{l.share}</DialogTitle>
            <DialogDescription className="sr-only">
              {projectName}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Input
              aria-label={l.share}
              readOnly
              value={shareUrl}
              onFocus={(event) => event.target.select()}
            />
            {copyError && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {l.copyFailed}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShareOpen(false)}>
              {l.cancel}
            </Button>
            <Button
              onClick={() => {
                void (async () => {
                  try {
                    await navigator.clipboard.writeText(shareUrl);
                    setCopied(true);
                    setCopyError(false);
                  } catch {
                    setCopyError(true);
                  }
                })();
              }}
            >
              {copied ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
              {copied ? l.copied : l.share}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
