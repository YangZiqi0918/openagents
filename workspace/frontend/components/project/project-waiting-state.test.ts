import { describe, expect, it } from 'vitest';
import type { WorkspaceAgent, WorkspaceMessage } from '@/lib/types';
import { projectWaitingState, visibleProjectMessages } from './project-waiting-state';

const start = Date.parse('2026-09-20T10:00:00.000Z');
const agents = [
  { agentName: 'helper', status: 'online' },
  { agentName: 'reviewer', status: 'online' },
] as WorkspaceAgent[];

function message(id: string, seconds: number, options: Partial<WorkspaceMessage> = {}): WorkspaceMessage {
  return {
    messageId: id, sessionId: 'project-room', senderType: 'human', senderName: 'Alice',
    content: id, mentions: [], targetAgents: null, messageType: 'chat', metadata: {},
    createdAt: new Date(start + seconds * 1000).toISOString(), ...options,
  };
}

const targeted = message('ask', 0, { targetAgents: ['helper'] });
const reply = message('reply', 10, { senderType: 'agent', senderName: 'helper' });

describe('shared project waiting state', () => {
  it('does not invent agent activity for human-only or no-response events', () => {
    expect(projectWaitingState([message('people', 0, { content: '@{bob}', targetAgents: ['__no_response__'] })], agents, start)).toBeNull();
    expect(projectWaitingState([message('plain', 0)], agents, start)).toBeNull();
    expect(projectWaitingState([message('foreign', 0, { targetAgents: ['other-project-agent'] })], agents, start)).toBeNull();
  });

  it('derives the same target from a server event for every project member, then clears on reply', () => {
    expect(projectWaitingState([targeted], agents, start + 1_000)).toEqual({
      triggerId: 'ask', agentName: 'helper', phase: 'active',
    });
    expect(projectWaitingState([targeted, reply], agents, start + 11_000)).toBeNull();
  });

  it('ignores placeholder thinking but preserves real thinking and resets the inactivity window', () => {
    const placeholder = message('placeholder', 95, { senderType: 'agent', senderName: 'helper', messageType: 'thinking', content: 'thinking...' });
    const progress = message('progress', 100, { senderType: 'agent', senderName: 'helper', messageType: 'thinking', content: 'Examining the result' });
    expect(visibleProjectMessages([targeted, placeholder, progress])).toEqual([targeted, progress]);
    expect(projectWaitingState([targeted, placeholder], agents, start + 120_000)?.phase).toBe('stale');
    expect(projectWaitingState([targeted, message('tool-step', 100, {
      senderType: 'agent', senderName: 'helper', messageType: 'status', content: 'Reading a file',
    })], agents, start + 120_000)?.phase).toBe('stale');
    expect(projectWaitingState([targeted, progress], agents, start + 180_000)?.phase).toBe('active');
    expect(projectWaitingState([targeted, progress], agents, start + 220_000)?.phase).toBe('stale');
  });

  it('shows only the latest unresolved target without clearing it for another agent response', () => {
    const later = message('ask-reviewer', 2, { senderName: 'Bob', targetAgents: ['reviewer'] });
    const helperReply = message('helper-reply', 3, { senderType: 'agent', senderName: 'helper' });
    expect(projectWaitingState([targeted, later, helperReply], agents, start + 4_000)?.agentName).toBe('reviewer');
    const reviewerReply = message('reviewer-reply', 5, { senderType: 'agent', senderName: 'reviewer' });
    expect(projectWaitingState([targeted, later, helperReply, reviewerReply], agents, start + 6_000)).toBeNull();
  });

  it('follows a server-confirmed agent handoff after the first agent finishes', () => {
    const handoff = message('handoff', 10, {
      senderType: 'agent', senderName: 'helper', targetAgents: ['reviewer'],
    });
    expect(projectWaitingState([targeted, handoff], agents, start + 11_000)).toEqual({
      triggerId: 'handoff', agentName: 'reviewer', phase: 'active',
    });
    expect(projectWaitingState([targeted, handoff, message('reviewed', 20, {
      senderType: 'agent', senderName: 'reviewer', targetAgents: ['__no_response__'],
    })], agents, start + 21_000)).toBeNull();
  });

  it('clears on failed, stopped or offline states without letting historical stops hide a new request', () => {
    const oldStop = message('old-stop', -1, { senderType: 'agent', senderName: 'helper', messageType: 'status', content: 'Execution stopped' });
    expect(projectWaitingState([oldStop, targeted], agents, start + 1_000)?.agentName).toBe('helper');
    expect(projectWaitingState([targeted, message('failed', 2, { senderType: 'agent', senderName: 'helper', metadata: { status_kind: 'failed' } })], agents, start + 3_000)).toBeNull();
    expect(projectWaitingState([targeted, message('stop', 2, { senderType: 'agent', senderName: 'helper', messageType: 'status', content: 'Execution stopped' })], agents, start + 3_000)).toBeNull();
    expect(projectWaitingState([targeted, message('offline', 2, { senderType: 'agent', senderName: 'System', metadata: { system_notice: 'no_agents_online' } })], agents, start + 3_000)).toBeNull();
    expect(projectWaitingState([targeted], [{ ...agents[0], status: 'offline' }, agents[1]], start + 1_000)).toBeNull();
    expect(projectWaitingState([targeted], agents, start + 1_000, [])).toBeNull();
    expect(projectWaitingState([targeted], agents, start + 1_000, ['helper'])?.agentName).toBe('helper');
  });
});
