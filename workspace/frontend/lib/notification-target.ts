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
