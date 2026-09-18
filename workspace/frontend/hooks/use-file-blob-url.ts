'use client';

import { useEffect, useState } from 'react';
import { useWorkspaceApi } from '@/lib/workspace-api-context';

export function useFileBlobUrl(fileId: string | null, contentType?: string) {
  const api = useWorkspaceApi();
  const [state, setState] = useState<{ fileId: string | null; api: typeof api; url: string | null; error: string | null }>({ fileId: null, api, url: null, error: null });

  useEffect(() => {
    if (!fileId) return;
    const controller = new AbortController();
    let url: string | null = null;
    void api.getFileBlob(fileId, { signal: controller.signal, contentType }).then((blob) => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      setState({ fileId, api, url, error: null });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setState({ fileId, api, url: null, error: error instanceof Error ? error.message : 'Unable to load file' });
      }
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, fileId, contentType]);

  const current = state.fileId === fileId && state.api === api;
  return { url: current ? state.url : null, error: current ? state.error : null, loading: !!fileId && (!current || (!state.url && !state.error)) };
}
