"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { CalendarPlus, Check, Undo2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  FilterBar,
  Notice,
  Select,
  StatusBadge,
  TextArea,
  TextField,
  useToast,
  type Column,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { approveLeave, cancelLeave, fetchWorkerLeaves, rejectLeave, requestLeave } from "@/lib/admin/endpoints";
import { applyFieldErrors, useAdminErrorMessage } from "@/lib/admin/errors";
import { businessToday } from "@/lib/admin/format";
import { adminKeys } from "@/lib/admin/keys";
import { readResourceConflict, readShortfalls, type ForceInput } from "@/lib/admin/ops/capacity";
import {
  LEAVE_STATUSES,
  LEAVE_TYPES,
  leaveActions,
  leaveDecisionSchema,
  leaveRequestSchema,
  type LeaveDecision,
  type LeaveRequestPayload,
  type LeaveRequestValues,
} from "@/lib/admin/ops/workforce";
import { useAdminSession } from "@/lib/admin/session";
import type { LeaveStatus, LeaveSummary, Shortfall, Worker, WorkerLeave } from "@/lib/admin/types";
import { FormErrorNotice } from "../../catalog/_components/CatalogFields";
import { ResourceConflictNotice, ShortfallDialog } from "../../_ops/Shortfall";
import { useOpsInvalidate } from "../../_ops/invalidate";
import { leaveTone, useOpsErrorKey, useOpsFieldError, useOpsText } from "../../_ops/opsText";

const PER_PAGE = 20;

/**
 * Leave tab. With leave.manage: the worker's leave with its history, requests, and approve / reject / cancel with a
 * note (approval blocks her whole days; RESOURCE_CONFLICT names what already holds the time, CAPACITY_SHORTFALL lists
 * the pools it would leave short). Without it: the upcoming leave dates the API shares (no type, reason or names).
 */
export function WorkerLeavesTab({ worker }: { worker: Worker }) {
  const { can } = useAdminSession();
  return can("leave.manage") ? <LeavesManager worker={worker} /> : <UpcomingLeaves worker={worker} />;
}

function UpcomingLeaves({ worker }: { worker: Worker }) {
  const t = useTranslations("admin.workers.leaves");
  const text = useOpsText();
  const leaves: LeaveSummary[] = worker.upcoming_leaves ?? [];
  return (
    <Card title={t("upcomingTitle")}>
      {leaves.length === 0 ? (
        <p className="text-sm text-ink-600">{t("noUpcoming")}</p>
      ) : (
        <ul className="flex flex-col">
          {leaves.map((leave) => (
            <li key={leave.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2.5 first:border-t-0">
              <span className="text-sm text-ink-900">
                {t("range", { from: text.dateShort(leave.date_from), to: text.dateShort(leave.date_to) })}{" "}
                <span className="text-ink-600">{t("days", { count: leave.days })}</span>
              </span>
              <StatusBadge tone={leaveTone[leave.status] ?? "neutral"}>{text.leaveStatus(leave.status)}</StatusBadge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function LeavesManager({ worker }: { worker: Worker }) {
  const t = useTranslations("admin.workers.leaves");
  const text = useOpsText();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [requesting, setRequesting] = useState(false);
  const [deciding, setDeciding] = useState<{ leave: WorkerLeave; decision: LeaveDecision } | null>(null);

  const list = useQuery({
    queryKey: adminKeys.workerLeaves(worker.id, { page, status }),
    queryFn: () => fetchWorkerLeaves(worker.id, { page, perPage: PER_PAGE, status: status as LeaveStatus | "" }),
    placeholderData: keepPreviousData,
  });

  const decisionIcon = { approve: Check, reject: X, cancel: Undo2 } as const;

  const columns: Column<WorkerLeave>[] = [
    {
      id: "dates",
      header: t("columns.dates"),
      cell: (l) => (
        <div className="flex flex-col">
          <span className="font-medium text-ink-900">{t("range", { from: text.dateShort(l.date_from), to: text.dateShort(l.date_to) })}</span>
          <span className="text-xs text-ink-600">{t("days", { count: l.days })}</span>
        </div>
      ),
    },
    { id: "type", header: t("columns.type"), cell: (l) => text.leaveType(l.type) },
    {
      id: "status",
      header: t("columns.status"),
      cell: (l) => <StatusBadge tone={leaveTone[l.status] ?? "neutral"}>{text.leaveStatus(l.status)}</StatusBadge>,
    },
    {
      id: "history",
      header: t("columns.history"),
      cell: (l) => (
        <ul className="flex flex-col gap-0.5 text-xs text-ink-600">
          {l.reason && <li className="text-sm text-ink-900">{l.reason}</li>}
          {l.requested_by && <li>{t("requestedBy", { name: l.requested_by.name })}</li>}
          {l.decided_by && (
            <li>
              {t(l.status === "rejected" ? "rejectedBy" : "approvedBy", { name: l.decided_by.name })}
              {l.decision_note ? ` · ${l.decision_note}` : ""}
            </li>
          )}
          {l.cancelled_by && (
            <li>
              {t("cancelledBy", { name: l.cancelled_by.name })}
              {l.cancellation_note ? ` · ${l.cancellation_note}` : ""}
            </li>
          )}
        </ul>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (l) => (
        <div className="flex flex-wrap justify-end gap-1">
          {leaveActions(l.status).map((decision) => {
            const Icon = decisionIcon[decision];
            return (
              <Button
                key={decision}
                variant="ghost"
                size="sm"
                className={decision === "approve" ? undefined : "text-danger-700 hover:bg-danger-50 hover:text-danger-700"}
                onClick={() => setDeciding({ leave: l, decision })}
                icon={<Icon aria-hidden className="size-4" />}
                aria-label={t(`actions.${decision}Label`, { from: text.dateShort(l.date_from) })}
              >
                {t(`actions.${decision}`)}
              </Button>
            );
          })}
        </div>
      ),
    },
  ];

  return (
    <Card
      title={t("title")}
      actions={
        <Button onClick={() => setRequesting(true)} icon={<CalendarPlus aria-hidden className="size-4" />}>
          {t("request")}
        </Button>
      }
    >
      <FilterBar
        canReset={status !== ""}
        onReset={() => {
          setStatus("");
          setPage(1);
        }}
      >
        <Select
          label={t("filters.status")}
          placeholder={t("filters.allStatuses")}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          options={LEAVE_STATUSES.map((s) => ({ value: s, label: text.leaveStatus(s) }))}
          containerClassName="min-w-[170px]"
        />
      </FilterBar>
      <DataTable
        caption={t("tableCaption")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(l) => l.id}
        loading={list.isPending}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={status ? t("noMatches") : t("empty")} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
        minWidth={820}
      />
      {requesting && <RequestLeaveDialog worker={worker} onClose={() => setRequesting(false)} />}
      {deciding && (
        <LeaveDecisionDialog worker={worker} leave={deciding.leave} decision={deciding.decision} onClose={() => setDeciding(null)} />
      )}
    </Card>
  );
}

function useLeaveInvalidate(workerId: number) {
  const invalidate = useOpsInvalidate();
  return () => invalidate(["admin", "workers", "leaves", workerId], adminKeys.worker(workerId), ["admin", "workers", "list"]);
}

function RequestLeaveDialog({ worker, onClose }: { worker: Worker; onClose: () => void }) {
  const t = useTranslations("admin.workers.leaves");
  const text = useOpsText();
  const fieldError = useOpsFieldError();
  const toast = useToast();
  const invalidate = useLeaveInvalidate(worker.id);
  const formId = useId();
  const [fieldsApplied, setFieldsApplied] = useState(false);
  const today = businessToday();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(leaveRequestSchema),
    defaultValues: { type: "annual", date_from: today, date_to: today, reason: "" } satisfies LeaveRequestValues,
  });

  const save = useMutation({
    mutationFn: (payload: LeaveRequestPayload) => requestLeave(worker.id, payload),
    onSuccess: (leave) => {
      invalidate();
      toast.success(t("requested", { from: text.dateShort(leave.date_from), to: text.dateShort(leave.date_to) }));
      onClose();
    },
    onError: (error) => setFieldsApplied(applyFieldErrors(error, setError, ["type", "date_from", "date_to", "reason"])),
  });

  const overlap = save.error instanceof AdminApiError && save.error.code === "LEAVE_OVERLAP" ? save.error.details : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !save.isPending && onClose()}
      title={t("requestTitle", { name: worker.display_name })}
      description={t("requestBody")}
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t("cancel")}
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {t("requestSubmit")}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={handleSubmit((payload) => save.mutate(payload))} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Select
            label={t("type")}
            required
            options={LEAVE_TYPES.map((type) => ({ value: type, label: text.leaveType(type) }))}
            error={fieldError(errors.type)}
            {...register("type")}
          />
        </div>
        <TextField
          type="date"
          label={t("dateFrom")}
          required
          dir="ltr"
          className="font-latin text-start"
          error={fieldError(errors.date_from)}
          {...register("date_from")}
        />
        <TextField
          type="date"
          label={t("dateTo")}
          required
          dir="ltr"
          className="font-latin text-start"
          error={fieldError(errors.date_to)}
          {...register("date_to")}
        />
        <div className="sm:col-span-2">
          <TextArea label={t("reason")} hint={t("reasonHint")} rows={2} maxLength={500} error={fieldError(errors.reason)} {...register("reason")} />
        </div>
        <p className="text-xs text-ink-600 sm:col-span-2">{t("limitsHint")}</p>
        <div className="sm:col-span-2">
          {overlap ? (
            <Notice tone="danger" title={t("overlapTitle")}>
              <p>
                {t("overlapBody", {
                  from: text.dateShort(String(overlap.date_from ?? "")),
                  to: text.dateShort(String(overlap.date_to ?? "")),
                  status: text.leaveStatus(String(overlap.status ?? "")),
                })}
              </p>
            </Notice>
          ) : (
            <FormErrorNotice error={save.error} fieldsApplied={fieldsApplied} />
          )}
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Approve (note optional), reject or cancel (note required). An approval that would leave booked pools short shows the
 * shortfall; with capacity.override it can be approved anyway (force + reason), the note staying the note.
 */
function LeaveDecisionDialog({
  worker,
  leave,
  decision,
  onClose,
}: {
  worker: Worker;
  leave: WorkerLeave;
  decision: LeaveDecision;
  onClose: () => void;
}) {
  const t = useTranslations("admin.workers.leaves");
  const text = useOpsText();
  const describe = useAdminErrorMessage();
  const errorText = useOpsErrorKey();
  const toast = useToast();
  const invalidate = useLeaveInvalidate(worker.id);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [forceShortfalls, setForceShortfalls] = useState<Shortfall[] | null>(null);

  const decide = useMutation({
    mutationFn: ({ note: value, force }: { note: string | null; force?: ForceInput }) => {
      if (decision === "approve") return approveLeave(leave.id, value, leave.version, force);
      if (decision === "reject") return rejectLeave(leave.id, value ?? "", leave.version);
      return cancelLeave(leave.id, value ?? "", leave.version);
    },
    onSuccess: (saved) => {
      invalidate();
      toast.success(t(`decided.${decision}`, { from: text.dateShort(saved.date_from), to: text.dateShort(saved.date_to) }));
      onClose();
    },
    onError: (error) => {
      // The leave changed meanwhile (INVALID_STATE / STALE_VERSION): refresh the list behind the dialog.
      if (error instanceof AdminApiError && ["INVALID_STATE", "STALE_VERSION"].includes(error.code)) invalidate();
    },
  });

  const parsedNote = () => {
    const result = leaveDecisionSchema(decision).safeParse({ note });
    if (!result.success) {
      setNoteError(errorText(result.error.issues[0]?.message) ?? null);
      return undefined;
    }
    setNoteError(null);
    return result.data.note;
  };

  const shortfalls = readShortfalls(decide.error);
  const conflict = readResourceConflict(decide.error);

  return (
    <>
      <ConfirmDialog
        open={forceShortfalls === null}
        onOpenChange={(open) => !open && onClose()}
        title={t(`decisionTitle.${decision}`, { name: worker.display_name })}
        description={t(`decisionBody.${decision}`, {
          from: text.date(leave.date_from),
          to: text.date(leave.date_to),
          days: leave.days,
        })}
        confirmLabel={t(`actions.${decision}`)}
        tone={decision === "approve" ? "primary" : "danger"}
        pending={decide.isPending}
        onConfirm={() => {
          const value = parsedNote();
          if (value === undefined) return;
          decide.mutate(
            { note: value },
            {
              onError: (error) => {
                const found = readShortfalls(error);
                if (found) setForceShortfalls(found);
              },
            },
          );
        }}
      >
        <TextArea
          label={decision === "approve" ? t("noteOptional") : t("note")}
          required={decision !== "approve"}
          hint={t("noteHint")}
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setNoteError(null);
          }}
          error={noteError}
        />
        {conflict ? (
          <ResourceConflictNotice error={decide.error} subject={worker.display_name} />
        ) : decide.error && !shortfalls ? (
          <Notice tone="danger">{describe(decide.error)}</Notice>
        ) : null}
      </ConfirmDialog>
      {forceShortfalls && (
        <ShortfallDialog
          shortfalls={forceShortfalls}
          pending={decide.isPending}
          forceError={decide.error && !readShortfalls(decide.error) ? decide.error : null}
          onClose={onClose}
          onForce={(force) => decide.mutate({ note: note.trim() === "" ? null : note.trim(), force })}
        />
      )}
    </>
  );
}
