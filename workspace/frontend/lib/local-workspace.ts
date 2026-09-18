import { API_URL, IS_LOCAL_MODE } from './api-config';

export interface LocalWorkspaceAccess {
  workspaceId: string;
  slug: string;
  name: string;
  token: string;
}

export async function requestLocalWorkspaceAccess(workspaceId?: string, signal?: AbortSignal): Promise<LocalWorkspaceAccess> {
  if (!IS_LOCAL_MODE) throw new Error('Local workspace access is disabled');
  const response = await fetch(`${API_URL}/v1/workspaces/local-access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: workspaceId }),
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`Local workspace API ${response.status}`);
  const { data } = await response.json();
  if (!data || typeof data.workspaceId !== 'string' || typeof data.slug !== 'string' ||
      typeof data.name !== 'string' || typeof data.token !== 'string') {
    throw new Error('Invalid local workspace credentials');
  }
  return data;
}
