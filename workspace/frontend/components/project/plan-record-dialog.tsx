'use client';

import { useEffect, useRef, useState } from 'react';
import { FileIcon, Loader2, Maximize2, Minimize2, Paperclip, RotateCcw, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useWorkspaceApi } from '@/lib/workspace-api-context';
import { IS_LOCAL_AUTH } from '@/lib/api-config';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog';
import { planLabels, validDates, type Members, type PlanAttachment, type PlanRecord } from './plan-record-model';
import {
  AssigneePicker,
  DateField,
  preservePlanFocus,
  PlanIconButton,
  PriorityPicker,
  StatusPicker,
  TagPicker,
} from './plan-record-controls';

interface PendingFile {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  progress: number;
  attachment?: PlanAttachment;
  error?: string;
}
export function PlanRecordDialog({
  initial,
  editing,
  members,
  tagOptions,
  canUpload,
  onSave,
  onClose,
}: {
  initial: PlanRecord;
  editing: boolean;
  members: Members;
  tagOptions: string[];
  canUpload: boolean;
  onSave: (record: PlanRecord) => boolean;
  onClose: () => void;
}) {
  const workspaceApi = useWorkspaceApi();
  const { locale } = useI18n();
  const l = planLabels(locale);
  const [draft, setDraft] = useState(initial);
  const [fullscreen, setFullscreen] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [queue, setQueue] = useState<PendingFile[]>([]);
  const queueRef = useRef(queue);
  const runRef = useRef(0);
  const busyRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      runRef.current += 1;
      controllerRef.current?.abort();
    },
    [],
  );
  const patchQueue = (update: (current: PendingFile[]) => PendingFile[]) => {
    queueRef.current = update(queueRef.current);
    setQueue(queueRef.current);
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || queue.length > 0;
  const requestClose = () => {
    if (dirty) setDiscard(true);
    else onClose();
  };
  const cancelUpload = () => {
    runRef.current += 1;
    controllerRef.current?.abort();
    busyRef.current = false;
    setBusy(false);
    patchQueue((items) =>
      items.map((item) => (item.status === 'uploading' ? { ...item, status: 'pending', progress: 0 } : item)),
    );
    setError(l.uploadCancelled);
  };
  const submit = async () => {
    if (busyRef.current || !draft.title.trim() || !validDates(draft.startDate, draft.dueDate)) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    const run = ++runRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    const current = () => runRef.current === run && !controller.signal.aborted;
    try {
      for (const item of queueRef.current.slice()) {
        if (!current()) return;
        if (item.status === 'uploaded') continue;
        patchQueue((items) =>
          items.map((entry) =>
            entry.id === item.id ? { ...entry, status: 'uploading', progress: 0, error: undefined } : entry,
          ),
        );
        try {
          const file = await workspaceApi.uploadFile(item.file, undefined, {
            signal: controller.signal,
            onProgress: (progress) => {
              if (current())
                patchQueue((items) => items.map((entry) => (entry.id === item.id ? { ...entry, progress } : entry)));
            },
          });
          if (!current()) return;
          const attachment = { id: file.id, filename: file.filename, contentType: file.contentType, size: file.size };
          patchQueue((items) =>
            items.map((entry) =>
              entry.id === item.id ? { ...entry, status: 'uploaded', progress: 1, attachment } : entry,
            ),
          );
        } catch (reason) {
          if (!current()) return;
          patchQueue((items) =>
            items.map((entry) =>
              entry.id === item.id
                ? { ...entry, status: 'failed', error: reason instanceof Error ? reason.message : l.uploadFailed }
                : entry,
            ),
          );
        }
      }
      if (!current()) return;
      if (queueRef.current.some((item) => item.status !== 'uploaded')) {
        setError(l.uploadFailed);
        return;
      }
      const attachments = [
        ...draft.attachments,
        ...queueRef.current.flatMap((item) => (item.attachment ? [item.attachment] : [])),
      ];
      const record = {
        ...draft,
        title: draft.title.trim(),
        attachments: attachments.filter(
          (item, index) => attachments.findIndex((other) => other.id === item.id) === index,
        ),
      };
      if (onSave(record)) onClose();
      else setError(l.formSaveError);
    } finally {
      if (current()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  const change = (patch: Partial<PlanRecord>) => setDraft((current) => ({ ...current, ...patch }));
  const datesValid = validDates(draft.startDate, draft.dueDate);
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogContent
          showCloseButton={false}
          variant={fullscreen ? 'fullscreen' : 'default'}
          className={
            fullscreen
              ? 'inset-0 h-[100dvh] max-h-[100dvh] rounded-none sm:rounded-none'
              : 'h-[min(680px,86dvh)] max-h-[86dvh] w-[calc(100vw-48px)] max-w-[1100px] max-md:left-0 max-md:top-0 max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none'
          }
          onCloseAutoFocus={preservePlanFocus}
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            requestClose();
          }}
        >
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <DialogHeader className="flex-row items-center justify-between gap-3 space-y-0 border-0 pb-2 text-left">
              <DialogTitle className="text-lg font-semibold">{editing ? l.details : l.createTitle}</DialogTitle>
              <DialogDescription className="sr-only">
                {l.title}, {l.description}, {l.status}, {l.assignee}
              </DialogDescription>
              <div className="flex items-center gap-1">
                <PlanIconButton
                  label={fullscreen ? l.restore : l.expand}
                  onClick={() => setFullscreen((value) => !value)}
                  className="max-md:hidden"
                >
                  {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </PlanIconButton>
                <PlanIconButton label={l.close} onClick={requestClose}>
                  <X className="size-5" />
                </PlanIconButton>
              </div>
            </DialogHeader>
            <DialogBody className="flex min-h-0 flex-1 flex-col gap-4 pt-3">
              <input
                autoFocus
                aria-label={l.title}
                placeholder={l.titlePlaceholder}
                value={draft.title}
                disabled={busy}
                onChange={(event) => change({ title: event.target.value })}
                className="w-full min-w-0 rounded-sm border-0 bg-transparent py-2 text-xl font-semibold outline-none placeholder:text-muted-foreground/50 focus-visible:outline-2 focus-visible:outline-ring"
              />
              <textarea
                aria-label={l.description}
                placeholder={l.descriptionPlaceholder}
                value={draft.description}
                disabled={busy}
                onChange={(event) => change({ description: event.target.value })}
                className="min-h-32 w-full min-w-0 flex-1 resize-none rounded-sm border-0 bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
              />
              <div className="mt-auto flex flex-wrap items-center gap-2 pb-2">
                <StatusPicker
                  value={draft.status}
                  label={l.status}
                  disabled={busy}
                  onChange={(status) => change({ status })}
                />
                <AssigneePicker
                  value={draft.assignees}
                  label={l.assignee}
                  placeholder={l.assignee}
                  members={members}
                  disabled={busy}
                  onChange={(assignees) => change({ assignees })}
                />
                <PriorityPicker
                  value={draft.priority}
                  label={l.priority}
                  placeholder={l.priority}
                  disabled={busy}
                  onChange={(priority) => change({ priority })}
                />
                <TagPicker
                  value={draft.tags}
                  label={l.tags}
                  options={tagOptions}
                  disabled={busy}
                  onChange={(tags) => change({ tags })}
                />
                <DateField
                  label={l.startDate}
                  value={draft.startDate}
                  disabled={busy}
                  onChange={(startDate) => change({ startDate })}
                />
                <DateField
                  label={l.dueDate}
                  value={draft.dueDate}
                  min={draft.startDate ?? undefined}
                  disabled={busy}
                  onChange={(dueDate) => change({ dueDate })}
                />
              </div>
              {!datesValid && (
                <p role="alert" className="text-sm text-destructive">
                  {l.dateError}
                </p>
              )}
              {(draft.attachments.length > 0 || queue.length > 0) && (
                <ul className="space-y-2 pb-2">
                  {draft.attachments.map((item) => (
                    <li key={item.id} className="flex min-w-0 items-center gap-2 text-sm">
                      <FileIcon className="size-4 shrink-0" />
                      <a
                        href={IS_LOCAL_AUTH ? '#' : workspaceApi.getFileUrl(item.id)}
                        onClick={IS_LOCAL_AUTH ? (event) => { event.preventDefault(); void workspaceApi.downloadFile(item.id, item.filename).catch((reason) => setError(reason instanceof Error ? reason.message : l.uploadFailed)); } : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${l.viewAttachment}: ${item.filename}`}
                        className="min-w-0 flex-1 truncate underline"
                        title={item.filename}
                      >
                        {item.filename}
                      </a>
                      <PlanIconButton
                        label={`${l.removeAttachment}: ${item.filename}`}
                        disabled={busy}
                        onClick={() =>
                          change({ attachments: draft.attachments.filter((entry) => entry.id !== item.id) })
                        }
                      >
                        <X className="size-4" />
                      </PlanIconButton>
                    </li>
                  ))}
                  {queue.map((item) => (
                    <li key={item.id} className="min-w-0 text-sm">
                      <div className="flex items-center gap-2">
                        <FileIcon className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate" title={item.file.name}>
                          {item.file.name}
                        </span>
                        {item.status === 'uploading' && (
                          <progress
                            aria-label={item.file.name}
                            value={item.progress}
                            max={1}
                            className="h-2 w-20 shrink-0"
                          />
                        )}
                        {item.status === 'failed' && (
                          <button
                            type="button"
                            aria-label={`${l.retry}: ${item.file.name}`}
                            onClick={() => void submit()}
                            disabled={busy}
                            className="rounded-sm p-2 hover:bg-muted"
                          >
                            <RotateCcw className="size-4" />
                          </button>
                        )}
                        <PlanIconButton
                          label={`${l.removeAttachment}: ${item.file.name}`}
                          disabled={busy}
                          onClick={() => patchQueue((items) => items.filter((entry) => entry.id !== item.id))}
                        >
                          <X className="size-4" />
                        </PlanIconButton>
                      </div>
                      {item.error && (
                        <p role="alert" className="break-words text-xs text-destructive">
                          {item.error}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {error && (
                <p role="alert" className="pb-2 text-sm text-destructive">
                  {error}
                </p>
              )}
            </DialogBody>
            <DialogFooter className="flex-row items-center justify-between gap-3 border-t border-border pt-3 max-sm:flex-row">
              <input
                ref={pickerRef}
                type="file"
                multiple
                aria-label={l.attachment}
                disabled={!canUpload || busy}
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  patchQueue((items) => [
                    ...items,
                    ...files
                      .filter(
                        (file) =>
                          !items.some(
                            (item) =>
                              item.file.name === file.name &&
                              item.file.size === file.size &&
                              item.file.lastModified === file.lastModified,
                          ),
                      )
                      .map((file): PendingFile => ({ id: crypto.randomUUID(), file, status: 'pending', progress: 0 })),
                  ]);
                }}
              />
              <span title={!canUpload ? l.previewUpload : undefined} className="mr-auto shrink-0">
                <PlanIconButton
                  label={!canUpload ? l.previewUpload : l.attachment}
                  disabled={!canUpload || busy}
                  onClick={() => pickerRef.current?.click()}
                >
                  <Paperclip className="size-5" />
                </PlanIconButton>
              </span>
              <div className="flex items-center gap-2">
                {busy && (
                  <Button type="button" variant="outline" onClick={cancelUpload}>
                    {l.cancelUpload}
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={requestClose}>
                  {l.cancel}
                </Button>
                <Button type="submit" variant="mono" disabled={!draft.title.trim() || !datesValid || busy}>
                  {busy ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      {l.submitting}
                    </>
                  ) : editing ? (
                    l.save
                  ) : (
                    l.create
                  )}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={discard} onOpenChange={setDiscard}>
        <DialogContent className="z-[90]">
          <DialogHeader>
            <DialogTitle>{l.discardTitle}</DialogTitle>
            <DialogDescription>{l.discardDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscard(false)}>
              {l.keepEditing}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                runRef.current += 1;
                controllerRef.current?.abort();
                onClose();
              }}
            >
              {l.discard}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
