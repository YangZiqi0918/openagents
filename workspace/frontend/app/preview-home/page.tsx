import { WorkspacePreview } from '@/components/home-preview/workspace-preview';
import { LocalWorkspace } from '@/components/local-workspace';
import { IS_LOCAL_MODE } from '@/lib/api-config';

export default function PreviewHomePage() {
  return IS_LOCAL_MODE ? <LocalWorkspace /> : <WorkspacePreview />;
}
