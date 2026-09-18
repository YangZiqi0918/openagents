// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  belongsToProject,
  clearProjectLink,
  isProjectChannel,
  isProjectCollaborationChannel,
  projectShareUrl,
  readCurrentProjectLink,
  readProjectLink,
  withoutProjectChannels,
} from './project-channels';
import {
  activityStorageKey,
  readActivityPreferences,
} from '@/components/project/project-activity-model';

afterEach(() => window.history.replaceState(null, '', '/'));

describe('project channel isolation', () => {
  it('uses the real container identity in project links and includes welcome conversations', () => {
    const link = new URL(projectShareUrl('http://localhost:3001', 'real-id', { projectId: 'real-id', projectName: 'Never trust URL names', sessionId: 'welcome' }));
    expect(link.pathname).toBe('/projects/real-id');
    expect(link.searchParams.get('session')).toBe('welcome');
    expect(link.searchParams.has('projectId')).toBe(false);
    expect(link.searchParams.has('projectName')).toBe(false);
    expect(isProjectCollaborationChannel('welcome')).toBe(true);
    for (const system of ['task:one', 'workflow:one', 'routine:one', 'system:one', 'dm:a,b']) expect(isProjectCollaborationChannel(system)).toBe(false);
    expect(readActivityPreferences(JSON.stringify({ selectedId: 'welcome', drafts: { welcome: 'Draft', 'task:one': 'Hidden' }, readAt: { welcome: 12 } }), 'real-id', true)).toEqual({ selectedId: 'welcome', drafts: { welcome: 'Draft' }, readAt: { welcome: 12 } });
  });
  it('matches exact project boundaries, not personal channels or similar IDs', () => {
    expect(belongsToProject('project:one:abc', 'one')).toBe(true);
    for (const name of [
      'project:one-other:abc',
      'project:one:',
      'project:two:abc',
      'dm:one,two',
      'general',
    ]) {
      expect(belongsToProject(name, 'one')).toBe(false);
    }
    expect(isProjectChannel('channel/project:one:abc')).toBe(true);
    expect(
      withoutProjectChannels({
        general: 'Personal',
        'project:one:abc': 'Project',
      }),
    ).toEqual({ general: 'Personal' });
  });

  it('shares project identity without credentials and rejects foreign session links', () => {
    const url = projectShareUrl('https://workspace.test', 'ws', {
      projectId: 'one',
      projectName: 'Shared project',
      sessionId: 'project:one:abc',
    });
    expect(readProjectLink(new URL(url).search)).toEqual({
      projectId: 'one',
      projectName: 'Shared project',
      sessionId: 'project:one:abc',
    });
    expect(url).not.toContain('token');
    expect(
      readProjectLink('?projectId=one&projectSessionId=project:two:abc')
        ?.sessionId,
    ).toBeUndefined();
    expect(
      readProjectLink('?projectId=one&projectSessionId=dm:one,two')?.sessionId,
    ).toBeUndefined();
    expect(readProjectLink('?projectId=../one')).toBeNull();
  });

  it('reads and clears web and desktop hash links without discarding other route state', () => {
    window.history.replaceState(
      { kept: true },
      '',
      '/ws?token=existing&projectId=one&projectName=One',
    );
    expect(readCurrentProjectLink()?.projectId).toBe('one');
    clearProjectLink();
    expect(window.location.search).toBe('?token=existing');
    expect(window.history.state).toEqual({ kept: true });
    window.history.replaceState(
      null,
      '',
      '/#/ws?projectId=two&projectSessionId=project:two:abc&other=1',
    );
    expect(readCurrentProjectLink()?.sessionId).toBe('project:two:abc');
    clearProjectLink();
    expect(window.location.hash).toBe('#/ws?other=1');
  });

  it('scopes preferences to user, workspace and project and tolerates corrupt storage', () => {
    expect(
      new Set([
        activityStorageKey('ws', 'one', 'user'),
        activityStorageKey('ws', 'two', 'user'),
        activityStorageKey('other', 'one', 'user'),
        activityStorageKey('ws', 'one', 'other'),
      ]).size,
    ).toBe(4);
    expect(readActivityPreferences('invalid', 'one')).toEqual({
      selectedId: null,
      drafts: {},
      readAt: {},
    });
    expect(
      readActivityPreferences(
        JSON.stringify({
          selectedId: 'dm:a,b',
          drafts: {
            'project:one:abc': 'Keep',
            'project:two:abc': 'Foreign',
            'project:one:bad': 12,
          },
          readAt: { 'project:one:abc': 123, 'project:two:abc': 456 },
        }),
        'one',
      ),
    ).toEqual({
      selectedId: null,
      drafts: { 'project:one:abc': 'Keep' },
      readAt: { 'project:one:abc': 123 },
    });
  });
});
