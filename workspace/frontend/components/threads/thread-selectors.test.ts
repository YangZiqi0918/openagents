import { describe, expect, it } from 'vitest';
import type { DMConversation, WorkspaceAgent, WorkspaceSession } from '@/lib/types';
import { selectAllConversations, selectUserThreads } from './thread-selectors';

const session = (sessionId: string, status: string, lastEventAt: number): WorkspaceSession => ({
  sessionId, workspaceId: 'workspace', createdBy: null, title: sessionId,
  status, starred: false, participants: [], master: null,
  orchestrationMode: 'dynamic', orchestrationInstruction: null, workflowId: null,
  createdAt: null, lastEventAt,
});

describe('conversation selectors', () => {
  const sessions = [
    session('recent', 'active', 30),
    session('archived', 'archived', 20),
    session('task:hidden', 'active', 60),
    session('routine:hidden', 'active', 50),
    session('deleted', 'deleted', 40),
  ];

  it('keeps the legacy thread selector and its system-channel exclusions', () => {
    expect(selectUserThreads(sessions, null).map((item) => item.sessionId)).toEqual(['recent', 'archived']);
  });

  it('puts active, archived and offline-agent direct conversations in one recent list', () => {
    const dms: DMConversation[] = [{
      agents: ['human:user', 'openagents:offline-agent'],
      lastMessage: { content: 'hello', sender: 'human:user', timestamp: 45 },
      messageCount: 1,
    }];
    const agents = [{ agentName: 'offline-agent', displayName: 'Offline Agent', status: 'offline' }] as WorkspaceAgent[];
    expect(selectAllConversations(sessions, dms, agents, null).map((item) => item.title))
      .toEqual(['Offline Agent', 'recent', 'archived']);
    expect(selectAllConversations(sessions, dms, agents, 'routine:hidden').some((item) => item.id === 'routine:hidden'))
      .toBe(false);
  });
});
