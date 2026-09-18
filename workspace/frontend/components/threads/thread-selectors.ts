import type { DMConversation, WorkspaceAgent, WorkspaceSession } from '@/lib/types';

export type ThreadSortOrder = 'recent' | 'oldest' | 'title';

export function selectUserThreads(
  sessions: WorkspaceSession[],
  currentSessionId: string | null,
  sortOrder: ThreadSortOrder = 'recent',
): WorkspaceSession[] {
  const eventTime = (session: WorkspaceSession) =>
    session.lastEventAt || (session.createdAt ? new Date(session.createdAt).getTime() : 0);

  return [...sessions]
    .filter((session) =>
      session.status !== 'deleted' &&
      !session.sessionId.startsWith('task:') &&
      (!session.sessionId.startsWith('routine:') || session.sessionId === currentSessionId))
    .sort((a, b) => {
      if (sortOrder === 'title') return (a.title || '').localeCompare(b.title || '');
      if (sortOrder === 'oldest') return eventTime(a) - eventTime(b);
      return eventTime(b) - eventTime(a);
    });
}

export interface CompactConversation {
  id: string;
  title: string;
  activityAt: number;
}

export function selectAllConversations(
  sessions: WorkspaceSession[],
  conversations: DMConversation[],
  agents: WorkspaceAgent[],
  currentSessionId: string | null,
): CompactConversation[] {
  const channels = selectUserThreads(sessions, currentSessionId)
    .filter((session) => !session.sessionId.startsWith('routine:') &&
      (session.status === 'active' || session.status === 'archived'))
    .map((session) => ({
      id: session.sessionId,
      title: session.title || '',
      activityAt: session.lastEventAt || (session.createdAt ? new Date(session.createdAt).getTime() : 0),
    }));

  const seen = new Set<string>();
  const direct = conversations.flatMap((conversation) => {
    const pair = [...conversation.agents].sort();
    const counterpart = pair.find((address) => !address.startsWith('human:'))
      || pair.find((address) => address !== 'human:user') || pair[0];
    const key = pair.some((address) => address.startsWith('human:'))
      ? `counterpart:${counterpart}` : `pair:${pair.join(',')}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const title = pair.every((address) => address.startsWith('openagents:'))
      ? pair.map((address) => agents.find((agent) => agent.agentName === address.slice(11))?.displayName || address.slice(11)).join(' ↔ ')
      : agents.find((agent) => agent.agentName === counterpart.replace(/^openagents:/, ''))?.displayName
        || counterpart.replace(/^(openagents:|human:)/, '');
    return [{ id: `dm:${pair.join(',')}`, title, activityAt: conversation.lastMessage.timestamp || 0 }];
  });

  return [...channels, ...direct].sort((a, b) => b.activityAt - a.activityAt);
}
