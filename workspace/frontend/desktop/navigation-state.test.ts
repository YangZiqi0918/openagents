import { describe, expect, it } from 'vitest';
import { restorableRoute } from './navigation-state';

describe('desktop route restoration', () => {
  it('restores membership home and workspace settings', () => {
    expect(restorableRoute('/')).toBe('/');
    expect(restorableRoute('/my-team/settings/devices')).toBe('/my-team/settings/devices');
  });
  it('never persists workspace access tokens or resume markers', () => {
    expect(restorableRoute('/my-team?token=secret&desktop_resume=1')).toBe('/my-team');
  });
  it('restores real project routes but never a login redirect or project query credentials', () => {
    expect(restorableRoute('/projects')).toBe('/projects');
    expect(restorableRoute('/projects/project-a?session=welcome')).toBe('/projects/project-a');
    expect(restorableRoute('/projects/project-a/unknown')).toBeNull();
    expect(restorableRoute('/login?returnTo=/projects/project-a')).toBeNull();
  });
  it.each(['https://example.com', '//example.com', '/%2Fexample.com', '/auth/callback', '/share/private', '/invite/private', '/team#token=secret', null, {}])('rejects non-workspace routes %s', value => {
    expect(restorableRoute(value)).toBeNull();
  });
});
