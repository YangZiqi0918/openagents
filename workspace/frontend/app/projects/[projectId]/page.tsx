'use client';

import { use } from 'react';
import { ProjectPage } from '@/components/project/project-page';

export default function ProjectRoute({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  return <ProjectPage key={projectId} projectId={projectId} />;
}
