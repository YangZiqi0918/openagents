'use client';

import { useEffect, useId, useState } from 'react';
import { MoreVertical, Pencil, Plus, Search, Trash2, Waypoints, X } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useConfirm, usePrompt } from '@/components/ui/dialogs-provider';
import { ProjectInternalPage } from './project-internal-page';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Project {
  id: string;
  name: string;
  description: string;
  addedAt: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PREVIEW_STORAGE_KEY = 'oa:projects:preview:v1';
const TEMPLATES = ['product', 'research', 'knowledge', 'delivery', 'bugs'] as const;
type Template = typeof TEMPLATES[number];

function isProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false;
  const project = value as Partial<Project>;
  return typeof project.id === 'string' && project.id.length > 0 &&
    typeof project.name === 'string' && project.name.trim().length > 0 &&
    typeof project.description === 'string' &&
    typeof project.addedAt === 'number' && Number.isFinite(project.addedAt);
}

function ProjectIcon() {
  return (
    <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-950 dark:bg-neutral-800 dark:text-neutral-100">
      <Waypoints className="size-6" strokeWidth={1.8} aria-hidden="true" />
    </span>
  );
}

const commandClass = 'inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-neutral-900 px-5 text-base font-medium text-white transition-colors hover:bg-neutral-800 active:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-white';
const iconButtonClass = 'flex size-9 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-100';

export function ProjectsView({ storageKey = PREVIEW_STORAGE_KEY }: { storageKey?: string }) {
  const t = useT();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const searchId = useId();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const ready = loadedKey === storageKey;
  const selected = projects.find((project) => project.id === selectedId);

  useEffect(() => {
    setQuery('');
    setSelectedId(null);
    setError('');
    const now = Date.now();
    let next: Project[] = [
      { id: 'getting-started', name: t('projects.guide'), description: '', addedAt: now - 30 * DAY_MS },
      { id: 'example-1', name: '1', description: '', addedAt: now - 22 * DAY_MS },
    ];
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null) {
        const parsed: unknown = JSON.parse(saved);
        if (!Array.isArray(parsed) || !parsed.every(isProject) ||
            new Set(parsed.map((project) => project.id)).size !== parsed.length) {
          throw new Error('Invalid saved projects');
        }
        next = parsed;
      }
    } catch {
      setError(t('projects.loadFailed'));
    }
    setProjects(next);
    setLoadedKey(storageKey);
    // Locale changes update labels, not persisted project names or edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const save = (next: Project[]) => {
    setProjects(next);
    setError('');
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      setError(t('projects.saveFailed'));
    }
  };

  const validateName = (name: string) => name.length > 60 ? t('projects.nameTooLong') : null;

  const create = async (template?: Template) => {
    const name = await prompt({
      title: t('projects.newProject'),
      placeholder: t('projects.projectName'),
      defaultValue: template ? t(`projects.templates.${template}.title`) : '',
      description: template ? t(`projects.templates.${template}.description`) : undefined,
      confirmText: t('common.create'),
      validate: validateName,
    });
    if (!name?.trim() || validateName(name.trim())) return;
    const project: Project = {
      id: crypto.randomUUID(), name: name.trim(), addedAt: Date.now(),
      description: template ? t(`projects.templates.${template}.description`) : '',
    };
    save([project, ...projects]);
    setQuery('');
    setSelectedId(project.id);
  };

  const rename = async (project: Project) => {
    const name = await prompt({
      title: t('projects.renameProject'), defaultValue: project.name,
      placeholder: t('projects.projectName'), confirmText: t('common.save'),
      validate: validateName,
    });
    if (!name?.trim() || validateName(name.trim())) return;
    save(projects.map((item) => item.id === project.id ? { ...item, name: name.trim() } : item));
  };

  const remove = async (project: Project) => {
    if (!(await confirm({
      title: t('projects.deleteProject'),
      description: t('projects.deleteConfirmation', { name: project.name }),
      confirmText: t('common.delete'), destructive: true,
    }))) return;
    save(projects.filter((item) => item.id !== project.id));
    if (selectedId === project.id) setSelectedId(null);
  };

  const addedLabel = (project: Project) => {
    const days = Math.max(0, Math.floor((Date.now() - project.addedAt) / DAY_MS));
    if (days === 0) return t('projects.addedNow');
    return days >= 30
      ? t('projects.addedMonths', { count: Math.floor(days / 30) })
      : t('projects.addedDays', { count: days });
  };

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = projects.filter((project) => project.name.toLocaleLowerCase().includes(normalizedQuery));

  if (selected && ready) {
    return <ProjectInternalPage projectId={selected.id} projectName={selected.name} onBack={() => setSelectedId(null)} workspaceModulesAvailable={storageKey !== PREVIEW_STORAGE_KEY} planStorageKey={`${storageKey}:plan:${selected.id}:v1`} />;
  }

  return (
    <div data-testid="projects-view" className="min-h-0 w-full flex-1 overflow-y-auto bg-background text-foreground lg:h-full" style={{ letterSpacing: 0 }}>
      <div className="mx-auto w-full max-w-[1400px] px-5 pb-12 pt-12 sm:px-8 lg:px-10">
        <header className="grid items-center gap-8 pb-12 pt-8 sm:min-h-[320px] lg:grid-cols-[0.9fr_1.1fr] lg:pb-16 lg:pt-12">
          <div>
            <h1 className="text-[32px] font-semibold leading-tight">{t('views.projects')}</h1>
            <p className="mt-4 text-base leading-7 text-neutral-500 sm:text-lg dark:text-neutral-400">{t('projects.subtitle')}</p>
            <button type="button" disabled={!ready} onClick={() => void create()} className={`${commandClass} mt-7`}>
              <Plus className="size-5" aria-hidden="true" />{t('projects.newProject')}
            </button>
          </div>
          <img src="/assets/images/project-team-reference.png" width={930} height={340} alt="" className="h-auto w-full max-w-[650px] justify-self-end object-contain dark:invert dark:hue-rotate-180" />
        </header>

        {error && <p role="alert" className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</p>}

        <section aria-labelledby={`${searchId}-mine`}>
          <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 id={`${searchId}-mine`} className="text-xl font-semibold">{t('projects.myProjects')}</h2>
            <div className="relative w-full sm:w-[260px]">
              <label htmlFor={searchId} className="sr-only">{t('projects.search')}</label>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-neutral-400" aria-hidden="true" />
              <input id={searchId} type="search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setQuery(''); }} placeholder={t('projects.search')} className="h-10 w-full rounded-lg border border-neutral-200 bg-background pl-10 pr-10 text-sm outline-none placeholder:text-neutral-400 focus-visible:border-neutral-400 focus-visible:outline-2 focus-visible:outline-neutral-300 [&::-webkit-search-cancel-button]:hidden dark:border-neutral-800" />
              {query && <button type="button" onClick={() => setQuery('')} aria-label={t('projects.clearSearch')} title={t('projects.clearSearch')} className={`${iconButtonClass} absolute right-1 top-1/2 -translate-y-1/2`}><X className="size-4" /></button>}
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2" aria-busy={!ready}>
            {!ready ? [0, 1].map((id) => <div key={id} className="flex min-h-[108px] items-center gap-4 rounded-lg border border-neutral-200 px-5 dark:border-neutral-800" role="status" aria-label={t('common.loading')}><span className="size-12 rounded-lg bg-neutral-100 motion-safe:animate-pulse dark:bg-neutral-800" /><span className="h-4 w-32 rounded bg-neutral-100 motion-safe:animate-pulse dark:bg-neutral-800" /></div>) : filtered.map((project) => (
              <div key={project.id} data-testid="project-card" className="group flex min-h-[108px] min-w-0 items-center gap-2 rounded-lg border border-neutral-200 bg-background px-5 transition-colors hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-600">
                <button type="button" onClick={() => setSelectedId(project.id)} className="flex min-w-0 flex-1 items-center gap-4 py-5 text-left focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-neutral-500">
                  <ProjectIcon />
                  <span className="min-w-0"><span className="block break-words text-base font-semibold leading-6">{project.name}</span><span className="mt-2 block text-sm text-neutral-400">{addedLabel(project)}</span></span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label={t('projects.projectActions', { name: project.name })} title={t('projects.projectActions', { name: project.name })} className={iconButtonClass}><MoreVertical className="size-[18px]" /></button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => void rename(project)}><Pencil className="size-4" />{t('common.rename')}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => void remove(project)}><Trash2 className="size-4" />{t('common.delete')}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
            {ready && filtered.length === 0 && <p role="status" className="col-span-full py-10 text-center text-sm text-neutral-400">{normalizedQuery ? t('projects.noResults') : t('projects.empty')}</p>}
          </div>
        </section>

        <section aria-labelledby={`${searchId}-templates`} className="mt-12">
          <h2 id={`${searchId}-templates`} className="mb-4 text-xl font-semibold">{t('projects.fromTemplate')}</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {TEMPLATES.map((template) => (
              <button key={template} type="button" disabled={!ready} onClick={() => void create(template)} className="flex min-h-[108px] min-w-0 items-center gap-4 rounded-lg border border-neutral-200 bg-background px-5 py-5 text-left transition-colors hover:border-neutral-300 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-neutral-500 disabled:opacity-50 dark:border-neutral-800 dark:hover:border-neutral-600 dark:hover:bg-neutral-900">
                <ProjectIcon />
                <span className="min-w-0"><span className="block break-words text-base font-semibold leading-6">{t(`projects.templates.${template}.title`)}</span><span className="mt-2 block text-sm leading-6 text-neutral-400">{t(`projects.templates.${template}.description`)}</span></span>
              </button>
            ))}
          </div>
        </section>
      </div>

    </div>
  );
}
