'use client';

import { useState, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react';
import {
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CirclePause,
  Plus,
  X,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import {
  STATUSES,
  PRIORITIES,
  planLabels,
  uniqueTags,
  todayDate,
  type Assignee,
  type Members,
  type Priority,
  type Status,
} from './plan-record-model';

// Do not steal focus from a control opened while a closing portal is unmounting.
export function preservePlanFocus(event: Event) {
  if (document.activeElement && document.activeElement !== document.body && document.activeElement.isConnected)
    event.preventDefault();
}
export function PlanIconButton({ label, children, ...props }: ComponentProps<'button'> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          {...props}
          className={`flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 ${props.className ?? ''}`}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent className="z-[100]">{label}</TooltipContent>
    </Tooltip>
  );
}
export function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative min-w-0">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full appearance-none rounded-sm bg-transparent pl-2 pr-6 text-sm outline-none hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {options.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-3 size-3.5 text-muted-foreground" />
    </div>
  );
}
const STATUS_ICONS = { todo: CircleDashed, doing: CircleDot, paused: CirclePause, done: CircleCheck };
const STATUS_COLORS = {
  todo: 'text-muted-foreground',
  doing: 'text-blue-500',
  paused: 'text-orange-500',
  done: 'text-emerald-500',
};
const PRIORITY_COLORS = {
  none: 'bg-muted text-muted-foreground',
  urgent: 'bg-pink-100 text-pink-950 dark:bg-pink-950 dark:text-pink-100',
  high: 'bg-orange-100 text-orange-950 dark:bg-orange-950 dark:text-orange-100',
  medium: 'bg-sky-100 text-sky-950 dark:bg-sky-950 dark:text-sky-100',
  low: 'bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100',
};
function navigateOptions(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
  const index = options.findIndex((option) => option === document.activeElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : (index + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
  event.preventDefault();
  options[next]?.focus();
}
export function StatusBadge({ value }: { value: Status }) {
  const { locale } = useI18n();
  const l = planLabels(locale);
  const Icon = STATUS_ICONS[value];
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted/70 px-2 py-1 text-sm">
      <Icon className={`size-4 shrink-0 ${STATUS_COLORS[value]}`} aria-hidden="true" />
      <span className="truncate">{l[value]}</span>
    </span>
  );
}
export function PriorityBadge({ value }: { value: Priority }) {
  const { locale } = useI18n();
  const key = value ?? 'none';
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-1 text-sm ${PRIORITY_COLORS[key]}`}>
      {planLabels(locale)[key]}
    </span>
  );
}
function PropertyPopover({
  label,
  trigger,
  children,
  disabled,
  open,
  onOpenChange,
}: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          disabled={disabled}
          className="flex min-h-9 min-w-0 max-w-full items-center overflow-hidden rounded-md px-1 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        >
          {trigger}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        onCloseAutoFocus={preservePlanFocus}
        className="z-[80] max-h-[min(360px,var(--radix-popover-content-available-height))] w-72 max-w-[calc(100vw-32px)] overflow-y-auto p-2"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
export function StatusPicker({
  value,
  onChange,
  label,
  disabled,
}: {
  value: Status;
  onChange: (value: Status) => void;
  label: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { locale } = useI18n();
  const l = planLabels(locale);
  return (
    <PropertyPopover
      label={label}
      trigger={<StatusBadge value={value} />}
      disabled={disabled}
      open={open}
      onOpenChange={setOpen}
    >
      <div role="menu" aria-label={l.status} onKeyDown={navigateOptions}>
        {STATUSES.map((status) => (
          <button
            type="button"
            role="menuitemradio"
            aria-checked={status === value}
            key={status}
            onClick={() => {
              onChange(status);
              setOpen(false);
            }}
            className="flex w-full items-center justify-between rounded-md p-1.5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <StatusBadge value={status} />
            {status === value && <Check className="size-4 text-blue-500" />}
          </button>
        ))}
      </div>
    </PropertyPopover>
  );
}
export function PriorityPicker({
  value,
  onChange,
  label,
  disabled,
  placeholder,
}: {
  value: Priority;
  onChange: (value: Priority) => void;
  label: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const { locale } = useI18n();
  const l = planLabels(locale);
  return (
    <PropertyPopover
      label={label}
      trigger={
        value === null && placeholder ? (
          <span className="rounded-md bg-muted/70 px-2 py-1 text-sm">{placeholder}</span>
        ) : (
          <PriorityBadge value={value} />
        )
      }
      disabled={disabled}
      open={open}
      onOpenChange={setOpen}
    >
      <div role="menu" aria-label={l.priority} onKeyDown={navigateOptions}>
        {PRIORITIES.map((priority) => (
          <button
            type="button"
            role="menuitemradio"
            aria-checked={priority === value}
            key={priority ?? 'none'}
            onClick={() => {
              onChange(priority);
              setOpen(false);
            }}
            className="flex w-full items-center justify-between rounded-md p-1.5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <PriorityBadge value={priority} />
            {priority === value && <Check className="size-4 text-blue-500" />}
          </button>
        ))}
      </div>
    </PropertyPopover>
  );
}
function MemberAvatar({ member }: { member: Assignee }) {
  if (member.kind === 'agent')
    return (
      <span aria-hidden="true">
        <AgentAvatar name={member.id.replace(/^agent:/, '')} size={22} />
      </span>
    );
  return (
    <Avatar aria-hidden="true" className="size-[22px] shrink-0">
      <AvatarImage src={member.avatarUrl ?? undefined} alt="" />
      <AvatarFallback className="bg-sky-500 text-xs text-white">{Array.from(member.name)[0] ?? '?'}</AvatarFallback>
    </Avatar>
  );
}
function AssigneeSummary({ value }: { value: Assignee[] }) {
  const { locale } = useI18n();
  const l = planLabels(locale);
  if (!value.length)
    return <span className="rounded-md bg-muted/70 px-2 py-1 text-sm text-muted-foreground">{l.unassigned}</span>;
  return (
    <span
      title={value.map((member) => member.name).join(', ')}
      className="flex min-w-0 max-w-full items-center gap-1 overflow-hidden"
    >
      {value.slice(0, 2).map((member) => (
        <span key={member.id} className="flex min-w-0 items-center gap-1 rounded-md bg-muted/70 px-1 py-1">
          <MemberAvatar member={member} />
          <span className="max-w-16 truncate text-sm">{member.name}</span>
        </span>
      ))}
      {value.length > 2 && <span className="shrink-0 text-xs text-muted-foreground">+{value.length - 2}</span>}
    </span>
  );
}
export function AssigneePicker({
  value,
  onChange,
  members,
  label,
  disabled,
  placeholder,
}: {
  value: Assignee[];
  onChange: (value: Assignee[]) => void;
  members: Members;
  label: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { locale } = useI18n();
  const l = planLabels(locale);
  const [query, setQuery] = useState('');
  const options = [
    ...members.options,
    ...value.filter((item) => !members.options.some((member) => member.id === item.id)),
  ];
  const visible = options.filter((member) =>
    [member.name, member.id].some((text) => text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
  );
  return (
    <PropertyPopover
      label={label}
      trigger={
        !value.length && placeholder ? (
          <span className="rounded-md bg-muted/70 px-2 py-1 text-sm">{placeholder}</span>
        ) : (
          <AssigneeSummary value={value} />
        )
      }
      disabled={disabled || members.loading}
      onOpenChange={(open) => {
        if (!open) setQuery('');
      }}
    >
      <Input
        autoFocus
        aria-label={l.memberSearch}
        placeholder={l.memberSearch}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault();
        }}
      />
      {(['human', 'agent'] as const).map((kind) => (
        <div key={kind}>
          {visible.some((member) => member.kind === kind) && (
            <p className="px-2 pb-1 pt-3 text-xs text-muted-foreground">{l[kind]}</p>
          )}
          {visible
            .filter((member) => member.kind === kind)
            .map((member) => (
              <label
                key={member.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={value.some((item) => item.id === member.id)}
                  onChange={(event) =>
                    onChange(event.target.checked ? [...value, member] : value.filter((item) => item.id !== member.id))
                  }
                  className="size-4 shrink-0 accent-foreground"
                />
                <MemberAvatar member={member} />
                <span className="min-w-0 truncate text-sm">{member.name}</span>
              </label>
            ))}
        </div>
      ))}
      {!visible.length && <p className="p-3 text-sm text-muted-foreground">{l.noMembers}</p>}
      {members.error && (
        <div role="alert" className="p-2 text-xs text-destructive">
          {l.memberError}
          <button type="button" onClick={members.retry} className="ml-2 underline">
            {l.retry}
          </button>
        </div>
      )}
    </PropertyPopover>
  );
}
export function TagPicker({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: string[];
  options: string[];
  onChange: (value: string[]) => void;
  label: string;
  disabled?: boolean;
}) {
  const { locale } = useI18n();
  const l = planLabels(locale);
  const [query, setQuery] = useState('');
  const name = query.trim();
  const all = uniqueTags([...options, ...value]);
  const visible = all.filter((tag) => tag.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
  const add = () => {
    if (name) {
      onChange(uniqueTags([...value, name]));
      setQuery('');
    }
  };
  return (
    <PropertyPopover
      label={label}
      disabled={disabled}
      onOpenChange={(open) => {
        if (!open) setQuery('');
      }}
      trigger={
        value.length ? (
          <span title={value.join(', ')} className="flex min-w-0 gap-1 overflow-hidden">
            {value.map((tag) => (
              <span key={tag} className="max-w-24 shrink-0 truncate rounded-md bg-muted px-2 py-1 text-xs">
                {tag}
              </span>
            ))}
          </span>
        ) : (
          <span className="rounded-md bg-muted/70 px-2 py-1 text-sm text-muted-foreground">{l.tags}</span>
        )
      }
    >
      <Input
        autoFocus
        aria-label={l.tagSearch}
        placeholder={l.tagSearch}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (name) add();
          }
        }}
      />
      {visible.map((tag) => (
        <label key={tag} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-muted">
          <input
            type="checkbox"
            checked={value.includes(tag)}
            onChange={(event) =>
              onChange(event.target.checked ? uniqueTags([...value, tag]) : value.filter((item) => item !== tag))
            }
            className="size-4 accent-foreground"
          />
          <span className="min-w-0 truncate text-sm">{tag}</span>
        </label>
      ))}
      {name && !all.includes(name) && (
        <button
          type="button"
          onClick={add}
          className="flex w-full items-center gap-2 rounded-md p-2 text-left text-sm hover:bg-muted"
        >
          <Plus className="size-4 shrink-0" />
          <span className="truncate">
            {l.newTag}: {name}
          </span>
        </button>
      )}
      {!visible.length && !name && <p className="p-3 text-center text-sm text-muted-foreground">{l.noTags}</p>}
    </PropertyPopover>
  );
}
export function DateField({
  label,
  value,
  min,
  onChange,
  disabled,
}: {
  label: string;
  value: string | null;
  min?: string;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  const { locale } = useI18n();
  const l = planLabels(locale);
  return (
    <div className="flex min-w-0 items-center gap-1 rounded-md bg-muted/70 px-2 py-1 focus-within:outline-2 focus-within:outline-ring">
      <div className="relative flex h-7 min-w-0 items-center gap-1.5">
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span aria-hidden="true" className="truncate text-sm">
          {value ? `${label} ${value}` : label}
        </span>
        <input
          type="date"
          aria-label={label}
          value={value ?? ''}
          min={min}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value || null)}
          onClick={(event) => {
            if (event.currentTarget.showPicker) {
              try {
                event.currentTarget.showPicker();
              } catch {}
            }
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      <button
        type="button"
        disabled={disabled}
        title={`${label}: ${l.today}`}
        aria-label={`${label}: ${l.today}`}
        onClick={() => onChange(todayDate())}
        className="rounded-sm p-1 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <CalendarCheck className="size-3.5" />
      </button>
      {value && (
        <button
          type="button"
          disabled={disabled}
          title={`${label}: ${l.clearDate}`}
          aria-label={`${label}: ${l.clearDate}`}
          onClick={() => onChange(null)}
          className="rounded-sm p-1 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
