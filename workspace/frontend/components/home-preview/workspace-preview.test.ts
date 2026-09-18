// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { WorkspacePreview } from './workspace-preview';
import { I18nProvider } from '@/lib/i18n';

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/components/ui/dialogs-provider', () => ({
  useConfirm: () => vi.fn(), usePrompt: () => vi.fn(),
}));

describe('preview Projects navigation', () => {
  it('opens the project page and preserves threads when switching back', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(() => root.render(React.createElement(I18nProvider, {
        initialLocale: 'zh-CN', hasStoredLocale: true,
        children: React.createElement(WorkspacePreview),
      })));
      const originalTitle = container.querySelector('main h1')?.textContent;
      const projects = Array.from(container.querySelectorAll<HTMLButtonElement>('nav button'))
        .find((button) => button.textContent === '\u9879\u76ee');
      expect(projects).toBeDefined();
      await act(() => projects!.click());

      const main = container.querySelector('main');
      expect(main?.querySelector('[data-testid="projects-view"]')).not.toBeNull();
      expect(main?.textContent).toContain('\u6211\u7684\u9879\u76ee');
      expect(main?.querySelector('a[href*="legacy-home"], textarea')).toBeNull();
      expect(projects?.getAttribute('aria-current')).toBe('page');
      expect(container.querySelector('#preview-sidebar')).not.toBeNull();

      const thread = container.querySelector<HTMLButtonElement>('#preview-thread-list button');
      await act(() => thread!.click());
      expect(container.querySelector('main h1')?.textContent).toBe(originalTitle);
      expect(container.querySelector('#preview-composer')).not.toBeNull();
      expect(container.querySelector('[data-testid="projects-view"]')).toBeNull();
    } finally {
      await act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});
