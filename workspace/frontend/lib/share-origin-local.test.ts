import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-config', () => ({ IS_LOCAL_MODE: true }));
import { shareOrigin } from './share-origin';

afterEach(() => vi.unstubAllGlobals());

describe('local share links', () => {
  it.each(['http://localhost:3000', 'http://127.0.0.1:3000'])(
    'keeps %s links on the local deployment', (origin) => {
      vi.stubGlobal('window', { location: new URL(origin) });
      expect(shareOrigin()).toBe(origin);
    },
  );
});
