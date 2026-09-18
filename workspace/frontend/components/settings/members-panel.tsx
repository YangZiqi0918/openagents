'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Link2, Loader2, RefreshCw, Trash2, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { useI18n, useT } from '@/lib/i18n';
import { roleLabel } from '@/lib/roles';
import { IS_LOCAL_AUTH } from '@/lib/api-config';
import type { WorkspaceApi } from '@/lib/api';
import type { TeamInvite, TeamMember, WorkspaceMe, WorkspaceRole } from '@/lib/types';

const ROLES: WorkspaceRole[] = ['owner', 'admin', 'member', 'viewer'];
const INVITE_ROLES: WorkspaceRole[] = ['admin', 'member', 'viewer'];
const failure = (reason: unknown) => reason instanceof Error ? reason.message : 'Request failed';

export function MembersPanel({ api, me }: { api: WorkspaceApi; me: WorkspaceMe }) {
  const t = useT();
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const confirm = useConfirm();
  const role = me.role || me.effectiveRole;
  const editable = role === 'owner' || role === 'admin';
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [target, setTarget] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('member');
  const [busy, setBusy] = useState(false);
  const [createdLink, setCreatedLink] = useState('');
  const generation = useRef(0);
  const operation = useRef(false);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError('');
    try {
      const [team, pending] = await Promise.all([api.getTeam(), editable ? api.listInvites() : Promise.resolve([])]);
      if (current !== generation.current) return;
      setMembers(team); setInvites(pending);
    } catch (reason) { if (current === generation.current) setError(failure(reason)); }
    finally { if (current === generation.current) setLoading(false); }
  }, [api, editable]);
  useEffect(() => { void load(); return () => { generation.current += 1; }; }, [load]);

  const run = async (action: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try { await action(); await load(); }
    catch (reason) { setError(failure(reason)); }
    finally { operation.current = false; setBusy(false); }
  };
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast.success(t('admin.linkCopied')); }
    catch { setCreatedLink(url); }
  };
  const invite = (directed: boolean) => run(async () => {
    const name = target.trim();
    if (directed && !name) return;
    const next = await api.createInvite(inviteRole, IS_LOCAL_AUTH || !directed ? undefined : name, IS_LOCAL_AUTH && directed ? name : undefined);
    setCreatedLink(next.url);
    if (directed) setTarget('');
    await copy(next.url);
  });
  const remove = async (member: TeamMember) => {
    const label = member.username || member.displayName || member.email;
    if (!(await confirm({ title: t('admin.removeTitle'), description: t('admin.removeDescription', { email: label }), confirmText: t('admin.removeMember'), destructive: true }))) return;
    await run(async () => { await api.removeTeamMember(member.email); });
  };
  const owners = members.filter((member) => member.role === 'owner').length;

  return <div data-testid="members-panel" className="h-full min-h-0 overflow-y-auto px-5 py-6 sm:px-8 lg:px-10">
    <h2 className="mb-5 text-lg font-semibold">{t('admin.membersTitle')}</h2>
    {error && <div role="alert" className="mb-5 flex items-center gap-3 rounded-md border border-destructive/30 p-3 text-sm text-destructive"><span className="flex-1">{error}</span><Button variant="ghost" mode="icon" size="sm" onClick={() => void load()} title={t('common.retry')} aria-label={t('common.retry')}><RefreshCw className="size-4" /></Button></div>}
    {editable && <section className="mb-7 space-y-3 border-b pb-6">
      <Label htmlFor="project-invite-target">{IS_LOCAL_AUTH ? (zh ? '邀请成员' : 'Invite member') : t('admin.inviteTitle')}</Label>
      <form onSubmit={(event) => { event.preventDefault(); void invite(true); }} className="flex flex-wrap items-center gap-2">
        <Input id="project-invite-target" type={IS_LOCAL_AUTH ? 'text' : 'email'} maxLength={IS_LOCAL_AUTH ? 32 : undefined} placeholder={IS_LOCAL_AUTH ? (zh ? '用户名' : 'Username') : t('admin.invitePlaceholder')} value={target} onChange={(event) => setTarget(event.target.value)} disabled={busy} className="min-w-[140px] flex-1" />
        <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as WorkspaceRole)} disabled={busy}><SelectTrigger className="h-9 w-32 shrink-0" aria-label={zh ? '邀请角色' : 'Invitation role'}><SelectValue /></SelectTrigger><SelectContent>{INVITE_ROLES.map((item) => <SelectItem key={item} value={item}>{roleLabel(t, item)}</SelectItem>)}</SelectContent></Select>
        <Button type="submit" disabled={busy || !target.trim()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}{zh ? '邀请' : 'Invite'}</Button>
      </form>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void invite(false)}><Link2 className="size-4" />{t('admin.createInviteLink')}</Button>
      {createdLink && <div className="flex min-w-0 items-center gap-2"><a href={createdLink} className="min-w-0 flex-1 truncate text-sm text-muted-foreground underline" target="_blank" rel="noreferrer">{createdLink}</a><Button variant="ghost" mode="icon" size="sm" title={t('admin.copyLink')} aria-label={t('admin.copyLink')} onClick={() => void copy(createdLink)}><Copy className="size-4" /></Button></div>}
    </section>}
    {editable && invites.some((item) => item.status === 'pending') && <section className="mb-7"><h3 className="mb-2 text-sm font-medium text-muted-foreground">{t('admin.pendingInvites')}</h3><div className="divide-y border-y">{invites.filter((item) => item.status === 'pending').map((item) => <div key={item.inviteId} className="flex min-w-0 items-center gap-3 py-3"><Link2 className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-sm">{item.username || (!IS_LOCAL_AUTH ? item.email : null) || t('admin.openInviteLink')}<span className="ml-2 text-xs text-muted-foreground">{roleLabel(t, item.role)}</span></p>{item.expiresAt && <p className="text-xs text-muted-foreground">{new Date(item.expiresAt).toLocaleDateString()}</p>}</div><Button variant="ghost" mode="icon" size="sm" disabled={busy} title={t('admin.copyLink')} aria-label={t('admin.copyLink')} onClick={() => void copy(item.url)}><Copy className="size-4" /></Button><Button variant="ghost" mode="icon" size="sm" disabled={busy} title={t('admin.inviteRevoke')} aria-label={t('admin.inviteRevoke')} onClick={() => void run(async () => { await api.revokeInvite(item.inviteId); })}><X className="size-4" /></Button></div>)}</div></section>}
    {loading ? <div role="status" className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : !error && members.length === 0 ? <p role="status" className="py-5 text-sm text-muted-foreground">{t('admin.noMembers')}</p> : <div className="divide-y border-y">{members.map((member) => {
      const label = member.username || member.displayName || (!IS_LOCAL_AUTH ? member.email : (zh ? '成员' : 'Member'));
      const self = member.email === me.email;
      const lastOwner = member.role === 'owner' && owners === 1;
      const canManage = editable && (role === 'owner' || member.role !== 'owner');
      return <div key={member.email} className="flex flex-wrap items-center gap-3 py-3"><div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{member.avatarUrl ? <img src={member.avatarUrl} alt="" className="size-8 rounded-full object-cover" /> : label.charAt(0).toUpperCase()}</div><div className="min-w-[90px] flex-1"><p className="break-words text-sm font-medium">{label}{self && <span className="ml-2 text-xs text-muted-foreground">{zh ? '你' : 'You'}</span>}</p></div>{canManage ? <Select value={member.role} disabled={busy || lastOwner} onValueChange={(value) => void run(async () => { await api.updateTeamMember(member.email, value as WorkspaceRole); })}><SelectTrigger className="h-9 w-32 shrink-0" aria-label={zh ? `${label} 的角色` : `Role for ${label}`}><SelectValue /></SelectTrigger><SelectContent>{ROLES.filter((item) => role === 'owner' || item !== 'owner').map((item) => <SelectItem key={item} value={item}>{roleLabel(t, item)}</SelectItem>)}</SelectContent></Select> : <span className="text-xs text-muted-foreground">{roleLabel(t, member.role)}</span>}{canManage && <Button variant="ghost" mode="icon" size="sm" disabled={busy || lastOwner} onClick={() => void remove(member)} title={t('admin.removeMember')} aria-label={t('admin.removeMember')}><Trash2 className="size-4 text-muted-foreground" /></Button>}</div>;
    })}</div>}
  </div>;
}
