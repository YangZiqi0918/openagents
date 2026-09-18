'use client';

import { useEffect, useRef } from 'react';
import { useLayout } from '@/components/layout/layout-context';
import { TasksView } from '@/components/tasks/tasks-view';
import { FileList } from '@/components/files/file-list';
import { FilePreview } from '@/components/files/file-preview';
import { TrashView } from '@/components/files/trash-view';
import { WorkflowsView } from '@/components/workflows/workflows-view';
import { BrowserTabList } from '@/components/browser/browser-tab-list';
import { BrowserView } from '@/components/browser/browser-view';
import { KnowledgeList } from '@/components/knowledge/knowledge-list';
import { KnowledgeView } from '@/components/knowledge/knowledge-view';

export type ProjectWorkspaceTab = 'tasks' | 'files' | 'workflows' | 'browser' | 'knowledge';

export function ProjectWorkspaceContent({ tab }: { tab: ProjectWorkspaceTab }) {
  const { isMobile, mobilePane, openMobileList, filesSection } = useLayout();
  const hasList = tab === 'files' || tab === 'browser' || tab === 'knowledge';
  const openMobileListRef = useRef(openMobileList);
  openMobileListRef.current = openMobileList;

  useEffect(() => {
    if (isMobile && hasList) openMobileListRef.current();
  }, [tab, isMobile, hasList]);

  if (tab === 'tasks') return <TasksView />;
  if (tab === 'workflows') return <WorkflowsView />;

  const list = tab === 'files' ? <FileList /> : tab === 'browser' ? <BrowserTabList /> : <KnowledgeList />;
  const detail = tab === 'files' ? (filesSection === 'trash' ? <TrashView /> : <FilePreview />)
    : tab === 'browser' ? <BrowserView /> : <KnowledgeView />;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {(!isMobile || mobilePane === 'list') && (
        <div data-testid="project-module-list" className="min-h-0 min-w-0 flex-1 overflow-hidden border-r border-border bg-background md:w-[280px] md:flex-none">
          {list}
        </div>
      )}
      {(!isMobile || mobilePane === 'detail') && (
        <div data-testid="project-module-detail" className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
          {detail}
        </div>
      )}
    </div>
  );
}
