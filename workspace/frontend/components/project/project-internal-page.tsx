'use client';

import { useState } from 'react';
import { FolderKanban } from 'lucide-react';
import { useI18n, useT } from '@/lib/i18n';
import { ProjectWorkspaceContent, type ProjectWorkspaceTab } from './project-workspace-content';
import { ProjectPlanPage } from './project-plan-page';
import { ProjectActivityPage } from './project-activity-page';

type ProjectTab = 'activity' | 'plan' | 'members' | ProjectWorkspaceTab;

const TABS: ProjectTab[] = ['activity', 'plan', 'tasks', 'files', 'workflows', 'browser', 'knowledge', 'members'];

interface ProjectInternalPageProps {
  projectId: string;
  projectName: string;
  onBack: () => void;
  workspaceModulesAvailable?: boolean;
  planStorageKey?: string;
  initialSessionId?: string;
}

export function ProjectInternalPage({ projectId, projectName, onBack, workspaceModulesAvailable = true, planStorageKey, initialSessionId }: ProjectInternalPageProps) {
  const t = useT();
  const { locale } = useI18n();
  const [activeTab, setActiveTab] = useState<ProjectTab>('activity');
  const labels: Record<ProjectTab, string> = {
    activity: locale === 'zh-CN' ? '动态' : 'Activity',
    plan: locale === 'zh-CN' ? '计划' : 'Plan',
    tasks: t('views.tasks'),
    files: t('views.files'),
    workflows: t('views.workflows'),
    browser: t('views.browser'),
    knowledge: t('views.knowledge'),
    members: locale === 'zh-CN' ? '成员管理' : 'Members',
  };

  return (
    <div data-testid="project-internal-page" data-project-id={projectId} className="flex h-full min-h-0 w-full flex-col bg-background text-foreground">
      <header className={`flex h-14 shrink-0 items-center gap-2 border-b border-border px-5 sm:px-8 lg:px-10 ${workspaceModulesAvailable ? '' : 'max-lg:pl-14'}`}>
        <FolderKanban className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <button type="button" onClick={onBack} className="shrink-0 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {t('views.projects')}
        </button>
        <span className="text-muted-foreground" aria-hidden="true">/</span>
        <span className="min-w-0 truncate text-sm font-medium" title={projectName}>{projectName}</span>
      </header>

      <nav aria-label={locale === 'zh-CN' ? '项目导航' : 'Project navigation'} className="shrink-0 overflow-x-auto border-b border-border px-5 sm:px-8 lg:px-10">
        <div className="flex min-w-max gap-7 sm:gap-9">
          {TABS.map((tab) => (
            <button key={tab} type="button" onClick={() => setActiveTab(tab)} aria-current={activeTab === tab ? 'page' : undefined} className={`relative flex h-12 shrink-0 items-center whitespace-nowrap text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring ${activeTab === tab ? 'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {labels[tab]}
            </button>
          ))}
        </div>
      </nav>

      <div data-testid="project-tab-content" data-active-tab={activeTab} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === 'activity' && workspaceModulesAvailable && <ProjectActivityPage projectId={projectId} projectName={projectName} initialSessionId={initialSessionId} />}
        {activeTab === 'plan' && <ProjectPlanPage projectId={projectId} storageKey={planStorageKey} workspaceModulesAvailable={workspaceModulesAvailable} />}
        {activeTab !== 'activity' && activeTab !== 'plan' && activeTab !== 'members' && workspaceModulesAvailable && (
          <ProjectWorkspaceContent key={activeTab} tab={activeTab} />
        )}
      </div>
    </div>
  );
}
