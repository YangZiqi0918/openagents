import { describe, expect, it } from 'vitest';
import { projectPlanNotificationPath } from './notification-target';

describe('project plan notification routes', () => {
  it('routes a review link in the current project before its task channel', () => {
    expect(projectPlanNotificationPath({ linkUrl: '/projects/project-1?tab=plan&item=item-1' }, 'project-1'))
      .toBe('/projects/project-1?tab=plan&item=item-1');
  });

  it('ignores foreign projects and external links', () => {
    expect(projectPlanNotificationPath({ linkUrl: '/projects/project-2?tab=plan&item=item-1' }, 'project-1')).toBeNull();
    expect(projectPlanNotificationPath({ linkUrl: 'https://elsewhere.example/projects/project-1?tab=plan&item=item-1' }, 'project-1')).toBeNull();
    expect(projectPlanNotificationPath({ linkUrl: '/projects/project-1?tab=tasks&item=item-1' }, 'project-1')).toBeNull();
  });
});
