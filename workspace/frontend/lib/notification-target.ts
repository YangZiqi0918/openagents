import type { NotificationItem } from './types';

export function invitationNotificationPath(notification: Pick<NotificationItem, 'linkUrl'>): string | null {
  if (!notification.linkUrl) return null;
  try {
    const url = new URL(notification.linkUrl, 'http://local-app');
    // Invitation URLs are app routes, even when a legacy server base differs.
    return /^\/invite\/[A-Za-z0-9_-]+$/.test(url.pathname) ? url.pathname : null;
  } catch {
    return null;
  }
}

/** Only route an administrator review notification to this project's own plan. */
export function projectPlanNotificationPath(notification: Pick<NotificationItem, 'linkUrl'>, workspaceId: string): string | null {
  if (!notification.linkUrl || !workspaceId) return null;
  try {
    const origin = typeof window === 'undefined' ? 'http://local-app' : window.location.origin;
    const url = new URL(notification.linkUrl, origin);
    if (url.origin !== origin || url.pathname !== `/projects/${encodeURIComponent(workspaceId)}`
      || url.searchParams.get('tab') !== 'plan' || !url.searchParams.get('item')) return null;
    return `${url.pathname}${url.search}`;
  } catch { return null; }
}

export function projectReviewNotificationPath(notification: Pick<NotificationItem, 'linkUrl'>, workspaceId: string): string | null {
  if (!notification.linkUrl || !workspaceId) return null;
  try {
    const origin = typeof window === 'undefined' ? 'http://local-app' : window.location.origin;
    const url = new URL(notification.linkUrl, origin);
    if (url.origin !== origin || url.pathname !== `/projects/${encodeURIComponent(workspaceId)}`
      || url.searchParams.get('tab') !== 'review' || !url.searchParams.get('task')) return null;
    return `${url.pathname}${url.search}`;
  } catch { return null; }
}
