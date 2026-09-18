'use client';

import { useAdminSettings } from '@/components/settings/admin-context';
import { MembersPanel } from '@/components/settings/members-panel';
import { useWorkspaceApi } from '@/lib/workspace-api-context';

export default function MembersSettingsPage() {
  const { me } = useAdminSettings();
  const api = useWorkspaceApi();
  return <MembersPanel api={api} me={me} />;
}
