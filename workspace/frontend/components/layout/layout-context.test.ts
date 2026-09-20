// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutProvider } from './layout-context';

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('layout wrapper', () => {
  it('constrains the embedded project pane without changing the personal layout', async () => {
    await act(async () => root.render(
      React.createElement(LayoutProvider, {
        embedded: true,
        children: React.createElement('div', null, 'Project'),
      }),
    ));
    const wrapper = host.querySelector<HTMLElement>('[data-slot="layout-wrapper"]')!;
    expect(wrapper.className).toContain('h-full');
    expect(wrapper.className).toContain('min-h-0');
    expect(wrapper.className).toContain('overflow-hidden');

    await act(async () => root.render(
      React.createElement(LayoutProvider, {
        children: React.createElement('div', null, 'Personal'),
      }),
    ));
    expect(wrapper.className).toBe('flex grow');
  });
});
