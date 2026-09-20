'use client';

import { useEffect, useState } from 'react';
import { FolderKanban, PlusSquare, X } from 'lucide-react';
import { useI18n, useT } from '@/lib/i18n';
import { ProjectWorkspaceContent, type ProjectWorkspaceTab } from './project-workspace-content';
import { ProjectPlanPage } from './project-plan-page';
import { ProjectActivityPage } from './project-activity-page';
import { ProjectMembersPage } from './project-members-page';
import { ProjectTaskReviewPage } from './project-task-review-page';
import { ConnectAgentView } from '@/components/connect/connect-agent-view';
import { useOptionalWorkspace } from '@/lib/workspace-context';
import { Button } from '@/components/ui/button';
import { useLayout, type ViewMode } from '@/components/layout/layout-context';

type ProjectTab = 'activity' | 'plan' | 'members' | 'review' | ProjectWorkspaceTab;

function ProjectConnectControl({ onOpen }: { onOpen: () => void }) {
  const me = useOptionalWorkspace()?.me;
  const t = useT();
  if (!['admin', 'owner'].includes(me?.role || '')) return null;
  return <Button variant="ghost" size="sm" onClick={onOpen} className="ml-auto"><PlusSquare className="size-4" /><span className="hidden sm:inline">{t('nav.connectAgent')}</span></Button>;
}

function ProjectModuleNavigation({ onSwitch }: { onSwitch: (tab: ProjectWorkspaceTab) => void }) {
  const { viewMode } = useLayout();
  useEffect(() => {
    if (['tasks', 'files', 'workflows', 'browser', 'knowledge'].includes(viewMode)) {
      onSwitch(viewMode as ProjectWorkspaceTab);
    }
  }, [viewMode, onSwitch]);
  return null;
}

const TABS: ProjectTab[] = ['activity', 'plan', 'tasks', 'files', 'workflows', 'browser', 'knowledge', 'members', 'review'];

interface ProjectInternalPageProps {
  projectId: string;
  projectName: string;
  onBack: () => void;
  workspaceModulesAvailable?: boolean;
  planStorageKey?: string;
  initialSessionId?: string;
  projectScoped?: boolean;
  initialTab?: 'plan' | 'review';
  initialPlanItemId?: string;
  initialPlanTaskId?: string;
  initialPlanTaskView?: string;
  onOpenPlanTask?: (itemId: string, taskId: string, view?: string) => void;
  onClosePlanTask?: () => void;
  onPlanTaskViewChange?: (view: string) => void;
  initialReviewTaskId?: string;
}

export function ProjectInternalPage({ projectId, projectName, onBack, workspaceModulesAvailable = true, planStorageKey, initialSessionId, projectScoped = false, initialTab, initialPlanItemId, initialPlanTaskId, initialPlanTaskView, onOpenPlanTask, onClosePlanTask, onPlanTaskViewChange, initialReviewTaskId }: ProjectInternalPageProps) {
  const t = useT();
  const { locale } = useI18n();
  const [activeTab, setActiveTab] = useState<ProjectTab>(initialTab ?? 'activity');
  const [connecting, setConnecting] = useState(false);
  const me = useOptionalWorkspace()?.me;
  const admin = me?.role === 'owner' || me?.role === 'admin';
  const visibleTabs = TABS.filter((tab) => tab !== 'review' || (workspaceModulesAvailable && admin));
  useEffect(() => {
    if (me && !admin && activeTab === 'review') setActiveTab('activity');
  }, [me, admin, activeTab]);
  useEffect(() => {
    if (initialTab === 'plan') setActiveTab('plan');
    if (initialTab === 'review' && admin) setActiveTab('review');
  }, [initialTab, initialPlanItemId, initialPlanTaskId, initialReviewTaskId, admin]);
  const labels: Record<ProjectTab, string> = {
    activity: locale === 'zh-CN' ? '动态' : 'Activity',
    plan: locale === 'zh-CN' ? '计划' : 'Plan',
    tasks: t('views.tasks'),
    files: t('views.files'),
    workflows: t('views.workflows'),
    browser: t('views.browser'),
    knowledge: t('views.knowledge'),
    members: locale === 'zh-CN' ? '成员管理' : 'Members',
    review: locale === 'zh-CN' ? '审核' : 'Review',
  };

  return (
    <div data-testid="project-internal-page" data-project-id={projectId} className="flex h-full min-h-0 w-full flex-col bg-background text-foreground">
      {projectScoped && <ProjectModuleNavigation onSwitch={setActiveTab} />}
      <header className={`flex h-14 shrink-0 items-center gap-2 border-b border-border px-5 sm:px-8 lg:px-10 ${workspaceModulesAvailable ? '' : 'max-lg:pl-14'}`}>
        <FolderKanban className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <button type="button" onClick={onBack} className="shrink-0 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {t('views.projects')}
        </button>
        <span className="text-muted-foreground" aria-hidden="true">/</span>
        <span className="min-w-0 truncate text-sm font-medium" title={projectName}>{projectName}</span>
        {workspaceModulesAvailable && projectScoped && <ProjectConnectControl onOpen={() => setConnecting(true)} />}
      </header>

      <nav aria-label={locale === 'zh-CN' ? '项目导航' : 'Project navigation'} className="shrink-0 overflow-x-auto border-b border-border px-5 sm:px-8 lg:px-10">
        <div className="flex min-w-max gap-7 sm:gap-9">
          {visibleTabs.map((tab) => (
            <button key={tab} type="button" onClick={() => setActiveTab(tab)} aria-current={activeTab === tab ? 'page' : undefined} className={`relative flex h-12 shrink-0 items-center whitespace-nowrap text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring ${activeTab === tab ? 'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {labels[tab]}
            </button>
          ))}
        </div>
      </nav>

      <div data-testid="project-tab-content" data-active-tab={activeTab} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {connecting ? <><div className="flex h-11 shrink-0 items-center justify-end border-b px-5"><Button variant="ghost" mode="icon" size="sm" onClick={() => setConnecting(false)} title={t('common.close')} aria-label={t('common.close')}><X className="size-4" /></Button></div><div className="min-h-0 flex-1"><ConnectAgentView onConnected={() => setConnecting(false)} /></div></> : <>
        {activeTab === 'activity' && workspaceModulesAvailable && <ProjectActivityPage projectId={projectId} projectName={projectName} initialSessionId={initialSessionId} />}
        {activeTab === 'plan' && <ProjectPlanPage projectId={projectId} storageKey={planStorageKey} workspaceModulesAvailable={workspaceModulesAvailable} focusItemId={initialPlanItemId} focusTaskId={initialPlanTaskId} taskView={initialPlanTaskView} onOpenTask={onOpenPlanTask} onCloseTask={onClosePlanTask} onTaskViewChange={onPlanTaskViewChange} />}
        {activeTab !== 'activity' && activeTab !== 'plan' && activeTab !== 'members' && activeTab !== 'review' && workspaceModulesAvailable && (
          <ProjectWorkspaceContent key={activeTab} tab={activeTab} />
        )}
        {activeTab === 'members' && workspaceModulesAvailable && projectScoped && <ProjectMembersPage />}
        {activeTab === 'review' && workspaceModulesAvailable && admin && <ProjectTaskReviewPage initialTaskId={initialReviewTaskId} />}
        </>}
      </div>
    </div>
  );
}
