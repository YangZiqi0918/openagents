import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { VIEWS_WITH_LIST } from '@/components/layout/layout-context';
import { ProjectsView } from './projects-view';

vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/components/ui/dialogs-provider', () => ({ usePrompt: () => () => Promise.resolve(null), useConfirm: () => () => Promise.resolve(false) }));

describe('Projects view', () => {
  it('renders the project surface without a workspace list panel', () => {
    const html = renderToStaticMarkup(React.createElement(ProjectsView));
    expect(html).toContain('data-testid="projects-view"');
    expect(html).toContain('views.projects');
  });

  it('does not open a secondary sidebar panel', () => {
    expect(VIEWS_WITH_LIST.has('projects')).toBe(false);
  });
});
