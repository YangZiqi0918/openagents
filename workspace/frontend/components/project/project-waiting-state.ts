import type { WorkspaceAgent, WorkspaceMessage } from '@/lib/types';

export interface ProjectWaitingState {
  triggerId: string;
  agentName: string;
  phase: 'active' | 'stale';
}

const STALE_AFTER_MS = 120_000;
const TERMINAL_KINDS = new Set(['completed', 'complete', 'succeeded', 'success', 'finished', 'failed', 'error', 'errored', 'cancelled', 'canceled']);

export function isProjectTerminalStatus(message: WorkspaceMessage, agentName: string) {
  if (message.senderType !== 'agent' || message.senderName !== agentName || message.messageType !== 'status') return false;
  const kind = message.metadata.status_kind;
  return (typeof kind === 'string' && TERMINAL_KINDS.has(kind.toLowerCase())) ||
    /stopped|stopping failed/i.test(message.content);
}

function realThinking(content: string) {
  const text = content.trim().toLowerCase();
  return text !== '' && text !== 'thinking...' && text !== 'thinking';
}

export function visibleProjectMessages(messages: WorkspaceMessage[]) {
  return messages.filter((message) => message.messageType !== 'thinking' || realThinking(message.content));
}

export function projectWaitingState(
  messages: WorkspaceMessage[],
  agents: WorkspaceAgent[],
  now: number,
  participantNames?: string[],
): ProjectWaitingState | null {
  const roster = new Map(agents.map((agent) => [agent.agentName, agent]));
  const pending = new Map<string, { triggerId: string; agentName: string; sequence: number; progressAt: number }>();
  let sequence = 0;

  for (const message of messages) {
    const timestamp = message.createdAt ? Date.parse(message.createdAt) : NaN;
    if (message.metadata.system_notice === 'no_agents_online' || message.metadata.system_notice === 'agent_stopped') {
      pending.clear();
      continue;
    }
    if (message.senderType === 'agent') {
      const current = pending.get(message.senderName);
      if (current) {
        const kind = message.metadata.status_kind;
        if ((typeof kind === 'string' && TERMINAL_KINDS.has(kind.toLowerCase())) ||
            message.messageType === 'error' || message.messageType === 'chat' ||
            isProjectTerminalStatus(message, message.senderName)) {
          pending.delete(message.senderName);
        } else if (Number.isFinite(timestamp) && timestamp > current.progressAt &&
            message.messageType === 'thinking' && realThinking(message.content)) {
          current.progressAt = timestamp;
        }
      }
    }
    // The server can route an agent's completed reply to the next agent.
    // Finish the previous turn above, then follow the confirmed handoff.
    if (message.messageType === 'chat') {
      const target = message.targetAgents?.find((name) => name !== '__no_response__' && roster.has(name));
      if (target && Number.isFinite(timestamp)) {
        pending.set(target, { triggerId: message.messageId, agentName: target, sequence: ++sequence, progressAt: timestamp });
      }
    }
  }

  const latest = Array.from(pending.values()).sort((a, b) => b.sequence - a.sequence)[0];
  if (!latest || roster.get(latest.agentName)?.status !== 'online' ||
      (participantNames && !participantNames.includes(latest.agentName))) return null;
  return {
    triggerId: latest.triggerId,
    agentName: latest.agentName,
    phase: now - latest.progressAt >= STALE_AFTER_MS ? 'stale' : 'active',
  };
}
