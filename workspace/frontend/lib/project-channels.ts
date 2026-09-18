export const PROJECT_CHANNEL_PREFIX = 'project:';

export function isProjectCollaborationChannel(address: string) {
  const id = address.replace(/^channel\//, '');
  return id.length > 0 && !['task:', 'workflow:', 'routine:', 'dm:', 'system:'].some((prefix) => id.startsWith(prefix));
}

export function isProjectChannel(address: string) {
  return address.replace(/^channel\//, '').startsWith(PROJECT_CHANNEL_PREFIX);
}

export function projectChannelPrefix(projectId: string) {
  return `${PROJECT_CHANNEL_PREFIX}${projectId}:`;
}

export function belongsToProject(channelName: string, projectId: string) {
  const prefix = projectChannelPrefix(projectId);
  return channelName.startsWith(prefix) && channelName.length > prefix.length;
}

export interface ProjectLink {
  projectId: string;
  projectName: string;
  sessionId?: string;
}

export function readProjectLink(search: string): ProjectLink | null {
  const params = new URLSearchParams(search);
  const projectId = params.get('projectId');
  // Channel names are also used in API paths; shared IDs must be path-safe.
  if (!projectId || !/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)) return null;
  const sessionId = params.get('projectSessionId') || undefined;
  return {
    projectId,
    projectName: params.get('projectName')?.trim().slice(0, 60) || projectId,
    sessionId:
      sessionId && belongsToProject(sessionId, projectId)
        ? sessionId
        : undefined,
  };
}

export function projectShareUrl(
  origin: string,
  workspaceId: string,
  link: ProjectLink,
) {
  // Only historical local classifications have a second, distinct project ID.
  if (workspaceId !== link.projectId) {
    const legacy = new URL(`/${encodeURIComponent(workspaceId)}`, origin);
    legacy.searchParams.set('projectId', link.projectId);
    legacy.searchParams.set('projectName', link.projectName);
    if (link.sessionId && belongsToProject(link.sessionId, link.projectId)) legacy.searchParams.set('projectSessionId', link.sessionId);
    return legacy.toString();
  }
  const url = new URL(`/projects/${encodeURIComponent(workspaceId)}`, origin);
  if (link.sessionId && isProjectCollaborationChannel(link.sessionId)) {
    url.searchParams.set('session', link.sessionId);
  }
  return url.toString();
}

export function readCurrentProjectLink() {
  const search = window.location.hash.startsWith('#/')
    ? new URL(window.location.hash.slice(1), 'https://workspace.openagents.org')
        .search
    : window.location.search;
  return readProjectLink(search);
}

export function clearProjectLink() {
  const url = new URL(window.location.href);
  const route = url.hash.startsWith('#/')
    ? new URL(url.hash.slice(1), 'https://workspace.openagents.org')
    : url;
  for (const key of ['projectId', 'projectName', 'projectSessionId'])
    route.searchParams.delete(key);
  if (route !== url) url.hash = `${route.pathname}${route.search}`;
  window.history.replaceState(window.history.state, '', url);
  if (route !== url) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function withoutProjectChannels<T>(
  values: Record<string, T>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(values).filter(([id]) => !isProjectChannel(id)),
  );
}
