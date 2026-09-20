'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  Columns3,
  Filter,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  SquarePen,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useWorkspace } from '@/lib/workspace-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/responsive-dialog';
import {
  AssigneePicker,
  FilterSelect as Choice,
  PlanIconButton as IconButton,
  PriorityPicker,
  StatusPicker,
  TagPicker,
} from './plan-record-controls';
import { PlanRecordDialog } from './plan-record-dialog';
import { ServerPlanPage } from './server-plan-page';
import {
  COLUMNS,
  EMPTY_MEMBERS,
  PRIORITIES,
  STATUSES,
  newPlanRecord,
  planLabels,
  readPlanRecords,
  uniqueTags,
  type Assignee,
  type Column,
  type Members,
  type PlanRecord,
} from './plan-record-model';

interface ProjectPlanPageProps {
  projectId: string;
  storageKey?: string;
  workspaceModulesAvailable?: boolean;
  focusItemId?: string;
}

export function ProjectPlanPage({ projectId, storageKey, workspaceModulesAvailable = true, focusItemId }: ProjectPlanPageProps) {
  if (workspaceModulesAvailable)
    return <ConnectedPlan key={storageKey ?? projectId} projectId={projectId} storageKey={storageKey} focusItemId={focusItemId} />;
  const key = storageKey ?? `oa:projects:preview:plan:${projectId}:v1`;
  return <PlanTable key={key} storageKey={key} members={EMPTY_MEMBERS} />;
}

function ConnectedPlan({ projectId, storageKey, focusItemId }: ProjectPlanPageProps) {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.workspaceId;
  const key = storageKey ?? `oa:projects:workspace:${workspaceId ?? 'local'}:plan:${projectId}:v1`;
  return <ServerPlanPage key={key} storageKey={key} focusItemId={focusItemId} />;
}

function EditableText({
  value,
  label,
  display,
  initialEditing = false,
  requiredMessage,
  placeholder,
  onSave,
  onCancel,
}: {
  value: string;
  label: string;
  display?: ReactNode;
  initialEditing?: boolean;
  requiredMessage?: string;
  placeholder?: string;
  onSave: (value: string) => void;
  onCancel?: () => void;
}) {
  const [editing, setEditing] = useState(initialEditing);
  const [text, setText] = useState(value);
  const [error, setError] = useState(false);
  const finished = useRef(false);
  const errorId = useId();
  const commit = () => {
    if (finished.current) return;
    if (requiredMessage && !text.trim()) {
      setError(true);
      return;
    }
    finished.current = true;
    onSave(text.trim());
    setEditing(false);
    setError(false);
  };
  if (!editing)
    return (
      <button
        type="button"
        aria-label={label}
        title={value || placeholder}
        onClick={() => {
          finished.current = false;
          setText(value);
          setError(false);
          setEditing(true);
        }}
        className="flex min-h-9 w-full min-w-0 items-center gap-1 overflow-hidden rounded-sm px-2 text-left text-sm hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {display ?? (
          <span className="truncate">{value || <span className="text-muted-foreground">{placeholder}</span>}</span>
        )}
      </button>
    );
  return (
    <div className="min-w-0 py-1">
      <Input
        autoFocus
        aria-label={label}
        value={text}
        placeholder={placeholder}
        aria-invalid={error}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setText(event.target.value);
          setError(false);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            finished.current = true;
            setEditing(false);
            setError(false);
            onCancel?.();
          }
        }}
        className="h-9 min-w-0 text-sm"
      />
      {error && (
        <p id={errorId} role="alert" className="mt-1 px-2 text-xs text-destructive">
          {requiredMessage}
        </p>
      )}
    </div>
  );
}

function PlanTable({
  storageKey,
  members,
  canUpload = false,
}: {
  storageKey: string;
  members: Members;
  canUpload?: boolean;
}) {
  const { locale } = useI18n();
  const l = planLabels(locale);
  const [records, setRecords] = useState<PlanRecord[]>([]);
  const recordsRef = useRef(records);
  const [loaded, setLoaded] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [form, setForm] = useState<{ initial: PlanRecord; editing: boolean } | null>(null);
  const [view, setView] = useState<'table' | 'board'>('table');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({
    status: '',
    assignee: '',
    priority: '',
  });
  const [columns, setColumns] = useState<Column[]>(COLUMNS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState<'delete' | 'reset' | null>(null);
  const deleteIds = useRef(new Set<string>());

  const load = () => {
    try {
      const next = readPlanRecords(localStorage.getItem(storageKey));
      recordsRef.current = next;
      setRecords(next);
      setBlocked(false);
      setSaveFailed(false);
    } catch {
      setBlocked(true);
    }
    setLoaded(true);
  };
  // Persist only explicit edits, never an empty initial render or failed load.
  useEffect(load, [storageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = (next: PlanRecord[]) => {
    recordsRef.current = next;
    setRecords(next);
    setBlocked(false);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  };
  const update = (row: PlanRecord, patch: Partial<PlanRecord>) => {
    if (blocked) return;
    if (recordsRef.current.some((item) => item.id === row.id)) {
      persist(recordsRef.current.map((item) => (item.id === row.id ? { ...item, ...patch } : item)));
    }
  };
  const add = () => {
    if (!loaded || blocked) return;
    setForm({ initial: newPlanRecord(), editing: false });
  };
  const saveForm = (record: PlanRecord) => {
    if (blocked) return false;
    const exists = recordsRef.current.some((row) => row.id === record.id);
    const next = exists
      ? recordsRef.current.map((row) => (row.id === record.id ? record : row))
      : [...recordsRef.current, record];
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      recordsRef.current = next;
      setRecords(next);
      setSaveFailed(false);
      return true;
    } catch {
      return false;
    }
  };
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = records.filter(
    (row) =>
      (!filters.status || row.status === filters.status) &&
      (!filters.priority || (row.priority ?? 'none') === filters.priority) &&
      (!filters.assignee ||
        (filters.assignee === 'none'
          ? !row.assignees.length
          : row.assignees.some((member) => member.id === filters.assignee))) &&
      (!normalizedQuery ||
        [row.title, row.description, ...row.assignees.map((member) => member.name), ...row.tags].some((text) =>
          text.toLocaleLowerCase().includes(normalizedQuery),
        )),
  );
  const tagOptions = uniqueTags(records.flatMap((row) => row.tags));
  const hasFilters = Object.values(filters).some(Boolean);
  const checkedCount = visible.filter((row) => selected.has(row.id)).length;
  const allChecked = visible.length > 0 && checkedCount === visible.length;
  const options = [...members.options];
  for (const row of records)
    for (const member of row.assignees) {
      if (!options.some((option) => option.id === member.id)) options.push(member);
    }
  const assigneeOptions = [
    { value: 'none', label: l.unassigned },
    ...options.map((member) => ({
      value: member.id,
      label: member.name,
      group: l[member.kind],
    })),
  ];
  const statusOptions = STATUSES.map((value) => ({ value, label: l[value] }));
  const priorityOptions = PRIORITIES.map((value) => ({
    value: value ?? 'none',
    label: l[value ?? 'none'],
  }));
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const disabled = !loaded || blocked;
  const cellClass = 'border-r border-border px-2 py-2 last:border-r-0';

  return (
    <div
      data-testid="project-plan-page"
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background px-5 pb-8 pt-4 sm:px-8 lg:px-10"
    >
      <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div
          className="flex items-center gap-2"
          role="group"
          aria-label={locale === 'zh-CN' ? '计划视图' : 'Plan views'}
        >
          <button
            type="button"
            aria-pressed={view === 'table'}
            onClick={() => setView('table')}
            className={`flex h-10 items-center gap-2 rounded-lg px-3 text-sm ${view === 'table' ? 'bg-muted font-semibold' : 'text-muted-foreground hover:bg-muted/60'} focus-visible:outline-2 focus-visible:outline-ring`}
          >
            <Table2 className="size-[18px]" aria-hidden="true" />
            {l.table}
          </button>
          <button
            type="button"
            aria-pressed={view === 'board'}
            onClick={() => setView('board')}
            className={`flex h-10 items-center gap-2 rounded-lg px-3 text-sm ${view === 'board' ? 'bg-muted font-semibold' : 'text-muted-foreground hover:bg-muted/60'} focus-visible:outline-2 focus-visible:outline-ring`}
          >
            <Columns3 className="size-[18px]" aria-hidden="true" />
            {l.board}
          </button>
        </div>
        {view === 'table' && (
          <div className="ml-auto flex items-center gap-2">
            {selected.size > 0 && (
              <IconButton
                label={l.delete}
                disabled={disabled}
                onClick={() => {
                  deleteIds.current = new Set(selected);
                  setConfirmation('delete');
                }}
              >
                <Trash2 className="size-[18px]" />
              </IconButton>
            )}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={l.filter}
                  title={l.filter}
                  className={`relative flex size-9 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring ${hasFilters ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                >
                  <Filter className="size-[18px]" />
                  {hasFilters && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-foreground" />}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="gap-4 p-4">
                {(['status', 'assignee', 'priority'] as const).map((field) => (
                  <div key={field} className="space-y-1">
                    <span className="text-xs font-medium">{l[field]}</span>
                    <Choice
                      label={`${l.filter}${l[field]}`}
                      value={filters[field]}
                      options={[
                        { value: '', label: l.all },
                        ...(field === 'status'
                          ? statusOptions
                          : field === 'priority'
                            ? priorityOptions
                            : assigneeOptions),
                      ]}
                      onChange={(value) =>
                        setFilters((current) => ({
                          ...current,
                          [field]: value,
                        }))
                      }
                    />
                  </div>
                ))}
                <Button
                  variant="ghost"
                  onClick={() => setFilters({ status: '', assignee: '', priority: '' })}
                  disabled={!hasFilters}
                >
                  {l.clear}
                </Button>
              </PopoverContent>
            </Popover>
            <IconButton
              label={l.search}
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen((open) => !open)}
              className={query ? 'bg-muted text-foreground' : ''}
            >
              <Search className="size-[18px]" />
            </IconButton>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={l.columns}
                  title={l.columns}
                  className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <SlidersHorizontal className="size-[18px]" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-48 p-3">
                {COLUMNS.map((column) => (
                  <label
                    key={column}
                    className="flex cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={columns.includes(column)}
                      onChange={() =>
                        setColumns((current) =>
                          current.includes(column)
                            ? current.filter((item) => item !== column)
                            : COLUMNS.filter((item) => current.includes(item) || item === column),
                        )
                      }
                      className="size-4 accent-foreground"
                    />
                    {l[column]}
                  </label>
                ))}
              </PopoverContent>
            </Popover>
            <span className="mx-1 h-6 border-l border-border" aria-hidden="true" />
            <Button variant="outline" size="lg" onClick={add} disabled={disabled} className="h-9 px-3 font-normal">
              {l.add}
            </Button>
          </div>
        )}
      </div>

      {view === 'board' ? (
        <div data-testid="plan-board" className="min-h-0 flex-1" />
      ) : (
        <>
          {searchOpen && (
            <div className="mb-4 flex shrink-0 items-center gap-2">
              <Input
                autoFocus
                type="search"
                aria-label={l.searchPlaceholder}
                placeholder={l.searchPlaceholder}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="max-w-sm"
              />
              <IconButton
                label={l.closeSearch}
                onClick={() => {
                  setQuery('');
                  setSearchOpen(false);
                }}
              >
                <X className="size-4" />
              </IconButton>
            </div>
          )}
          {(blocked || saveFailed) && (
            <div
              role="alert"
              className="mb-4 flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
            >
              <span className="mr-auto">{blocked ? l.loadError : l.saveError}</span>
              <Button variant="ghost" onClick={blocked ? load : () => persist(recordsRef.current)}>
                <RotateCcw className="size-4" />
                {l.retry}
              </Button>
              {blocked && (
                <Button variant="outline" onClick={() => setConfirmation('reset')}>
                  {l.reset}
                </Button>
              )}
            </div>
          )}
          {members.loading && (
            <div role="status" className="mb-3 flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {l.memberLoading}
            </div>
          )}
          {members.error && (
            <div role="alert" className="mb-3 flex shrink-0 items-center gap-2 text-sm text-destructive">
              <span>{l.memberError}</span>
              <Button variant="ghost" onClick={members.retry}>
                <RotateCcw className="size-4" />
                {l.retry}
              </Button>
            </div>
          )}
          <div className="min-h-0 min-w-0 flex-1 overflow-auto">
            <div className="min-w-[900px] overflow-hidden rounded-md border border-border">
              <table
                className="w-full table-fixed border-collapse text-left text-sm"
                aria-label={locale === 'zh-CN' ? '计划表格' : 'Plan table'}
              >
                <colgroup>
                  <col className="w-14" />
                  <col />
                  {columns.includes('status') && <col className="w-[140px]" />}
                  {columns.includes('assignee') && <col className="w-[180px]" />}
                  {columns.includes('priority') && <col className="w-[120px]" />}
                  {columns.includes('tags') && <col className="w-[180px]" />}
                </colgroup>
                <thead>
                  <tr className="h-14 border-b border-border">
                    <th className="border-r border-border text-center">
                      <input
                        type="checkbox"
                        aria-label={l.selectAll}
                        checked={allChecked}
                        ref={(element) => {
                          if (element) element.indeterminate = checkedCount > 0 && !allChecked;
                        }}
                        disabled={!visible.length || disabled}
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            for (const row of visible) {
                              if (allChecked) next.delete(row.id);
                              else next.add(row.id);
                            }
                            return next;
                          })
                        }
                        className="size-4 accent-foreground align-middle"
                      />
                    </th>
                    <th className="border-r border-border px-3 font-normal">{l.title}</th>
                    {columns.map((column) => (
                      <th key={column} className="border-r border-border px-3 font-normal last:border-r-0">
                        {l[column]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!loaded && (
                    <tr>
                      <td colSpan={columns.length + 2} className="h-12 px-4" role="status">
                        <Loader2 className="mr-2 inline size-4 animate-spin" />
                        {l.loading}
                      </td>
                    </tr>
                  )}
                  {visible.map((row, index) => (
                    <tr
                      key={row.id}
                      data-testid="plan-record"
                      className={`group/plan-row min-h-12 border-b border-border ${selected.has(row.id) ? 'bg-muted/60' : ''}`}
                    >
                      <td className="border-r border-border text-center">
                        <div className="relative flex h-9 items-center justify-center">
                          {!selected.has(row.id) && (
                            <span
                              aria-hidden="true"
                              className="hidden text-muted-foreground md:block md:group-hover/plan-row:opacity-0 md:group-focus-within/plan-row:opacity-0"
                            >
                              {index + 1}
                            </span>
                          )}
                          <input
                            type="checkbox"
                            aria-label={`${l.selectRow}: ${row.title}`}
                            checked={selected.has(row.id)}
                            disabled={disabled}
                            onChange={() => toggle(row.id)}
                            className={`absolute size-4 accent-foreground ${selected.has(row.id) ? '' : 'md:opacity-0 md:group-hover/plan-row:opacity-100 md:group-focus-within/plan-row:opacity-100'}`}
                          />
                        </div>
                      </td>
                      <td className={cellClass}>
                        <div className="flex min-w-0 items-center gap-1">
                          <div className="min-w-0 flex-1">
                            <EditableText
                              value={row.title}
                              label={`${l.edit}${l.title}: ${row.title}`}
                              requiredMessage={l.required}
                              placeholder={l.title}
                              onSave={(title) => update(row, { title })}
                            />
                          </div>
                          <IconButton
                            label={`${l.details}: ${row.title}`}
                            disabled={disabled}
                            onClick={() => setForm({ initial: row, editing: true })}
                          >
                            <SquarePen className="size-4" />
                          </IconButton>
                        </div>
                      </td>
                      {columns.includes('status') && (
                        <td className={cellClass}>
                          <StatusPicker
                            label={`${l.status}: ${row.title}`}
                            value={row.status}
                            disabled={disabled}
                            onChange={(status) => update(row, { status })}
                          />
                        </td>
                      )}
                      {columns.includes('assignee') && (
                        <td className={cellClass}>
                          <AssigneePicker
                            label={`${l.assignee}: ${row.title}`}
                            value={row.assignees}
                            members={members}
                            disabled={disabled}
                            onChange={(assignees) => update(row, { assignees })}
                          />
                        </td>
                      )}
                      {columns.includes('priority') && (
                        <td className={cellClass}>
                          <PriorityPicker
                            label={`${l.priority}: ${row.title}`}
                            value={row.priority}
                            disabled={disabled}
                            onChange={(priority) => update(row, { priority })}
                          />
                        </td>
                      )}
                      {columns.includes('tags') && (
                        <td className={cellClass}>
                          <TagPicker
                            label={`${l.edit}${l.tags}: ${row.title}`}
                            value={row.tags}
                            options={tagOptions}
                            disabled={disabled}
                            onChange={(tags) => update(row, { tags })}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                  {loaded && !blocked && visible.length === 0 && (normalizedQuery || hasFilters) && (
                    <tr>
                      <td
                        colSpan={columns.length + 2}
                        role="status"
                        className="h-14 border-b border-border px-4 text-muted-foreground"
                      >
                        {l.noResults}
                      </td>
                    </tr>
                  )}
                  <tr className="h-12">
                    <td className="border-r border-border text-center">
                      <IconButton label={l.addRow} onClick={add} disabled={disabled} className="mx-auto">
                        <Plus className="size-[18px]" />
                      </IconButton>
                    </td>
                    <td colSpan={columns.length + 1} />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <Dialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmation === 'reset' ? l.resetTitle : l.deleteTitle}</DialogTitle>
            <DialogDescription>{confirmation === 'reset' ? l.resetDescription : l.deleteDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmation(null)}>
              {l.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmation === 'reset') {
                  persist([]);
                  setSelected(new Set());
                } else {
                  persist(recordsRef.current.filter((row) => !deleteIds.current.has(row.id)));
                  setSelected((current) => new Set(Array.from(current).filter((id) => !deleteIds.current.has(id))));
                }
                setConfirmation(null);
              }}
            >
              {confirmation === 'reset' ? l.resetConfirm : l.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {form && (
        <PlanRecordDialog
          key={form.initial.id}
          initial={form.initial}
          editing={form.editing}
          members={members}
          tagOptions={tagOptions}
          canUpload={canUpload}
          onSave={saveForm}
          onClose={() => setForm(null)}
        />
      )}
    </div>
  );
}
