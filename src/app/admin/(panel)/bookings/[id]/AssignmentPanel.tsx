"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Activity, Repeat, ShieldAlert, UserMinus, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import {
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  ErrorState,
  LoadingBlock,
  Notice,
  Select,
  StatusBadge,
  TextArea,
  TextField,
  showFieldError,
  useToast,
} from "@/components/admin";
import { isPollDriven } from "@/lib/admin/backgroundRefresh";
import { AdminApiError } from "@/lib/admin/client";
import { overrideRequiredOf } from "@/lib/admin/bookings/actions";
import { VISIT_STATUS_TARGETS, assignmentReasonSchema, visitStatusSchema, type VisitStatusValues } from "@/lib/admin/bookings/forms";
import { assignWorkers, fetchVisitCandidates, replaceWorker, setVisitStatus, unassignWorker } from "@/lib/admin/endpoints";
import { applyFieldErrors, useAdminErrorMessage } from "@/lib/admin/errors";
import { adminKeys } from "@/lib/admin/keys";
import { CAPACITY_OVERRIDE_PERMISSION, FORCE_REASON_MAX, readShortfalls } from "@/lib/admin/ops/capacity";
import { useAdminSession } from "@/lib/admin/session";
import type { BookingDetail, BookingVisit, CandidateWorker, VisitCandidates } from "@/lib/admin/types";
import { ResourceConflictNotice, ShortfallTable } from "../../_ops/Shortfall";
import { SlotLabel } from "../_components/BookingBits";
import { useFocusRescue } from "../_components/focus";
import { useBookingRefresh } from "../_components/refresh";
import { useBookingText, visitTone } from "../_components/bookingText";

/*
 * Assignment on the booking page (spec §8.5–§8.7, §14.3 Assignments; assignments.manage, candidates also with
 * schedule.view): per visit, the named team, the ranked candidates with their reasons, and the workers the rules
 * leave out with theirs. The API names exactly the missing number of workers per assignment. An override
 * (capacity.override and a reason of at least 10 characters) relaxes the soft rules only (another zone, the travel
 * buffer); a worker already busy, on leave or on a Live-out day (RESOURCE_CONFLICT) and a seat or pool shortfall never
 * can be overridden.
 */

const OPEN_BOOKING = ["pending_confirmation", "confirmed"];
const OPEN_VISIT = ["scheduled", "worker_assigned"];
/** Visits that will not take place can always be cleared. */
const CLEARABLE_VISIT = [...OPEN_VISIT, "cancelled", "missed_by_company"];
/** Visits operations may still move on (D-01): not finished, missed or cancelled. */
const LIVE_VISIT = [...OPEN_VISIT, "en_route", "arrived", "in_progress"];

export function AssignmentPanel({ booking }: { booking: BookingDetail }) {
  const t = useTranslations("admin.bookings.assignment");
  if (booking.visits.length === 0) return null;
  return (
    <Card title={t("title")}>
      {booking.preferred_worker && <Notice tone="info">{t("preferred", { name: booking.preferred_worker.display_name })}</Notice>}
      <div className="flex flex-col gap-5">
        {booking.visits.map((visit) => (
          <VisitTeam key={visit.id} booking={booking} visit={visit} />
        ))}
      </div>
    </Card>
  );
}

type Selection = { id: number; name: string; needsOverride: boolean; rules: string[] };

function VisitTeam({ booking, visit }: { booking: BookingDetail; visit: BookingVisit }) {
  const t = useTranslations("admin.bookings.assignment");
  const text = useBookingText();
  const { can, canAny } = useAdminSession();
  const canManage = can("assignments.manage");
  const canSeeCandidates = canAny(["assignments.manage", "schedule.view"]);
  const assignable = OPEN_BOOKING.includes(booking.status) && OPEN_VISIT.includes(visit.status);
  const queryClient = useQueryClient();
  const candidates = useQuery({
    queryKey: adminKeys.visitCandidates(visit.id),
    // A read the booking page's timed refresh set off (no one acted since) is a background poll too.
    queryFn: () => fetchVisitCandidates(visit.id, { background: isPollDriven(queryClient) }),
    enabled: canSeeCandidates && assignable,
  });
  const summary = candidates.data?.visit;
  const required = booking.workers_count;

  // The team as the booking and as the candidates tell it. When a re-read of the booking (the timed refresh, Refresh,
  // focus) brings another team or visit status, the candidates are behind: the booking's team is shown, without the
  // picker, until they are read again. After this tab's own change the candidates are re-read first and stay shown.
  const bookingTeam = teamKey(visit.status, visit.assignments.map((a) => a.worker_id));
  const summaryTeam = summary ? teamKey(summary.status, summary.workers.map((w) => w.id)) : null;
  const [seen, setSeen] = useState({ booking: bookingTeam, summary: summaryTeam, bookingAhead: false });
  let bookingAhead = seen.bookingAhead;
  if (seen.booking !== bookingTeam || seen.summary !== summaryTeam) {
    bookingAhead = seen.summary === summaryTeam;
    setSeen({ booking: bookingTeam, summary: summaryTeam, bookingAhead });
  }
  const behind = summaryTeam !== null && bookingAhead && summaryTeam !== bookingTeam;
  useEffect(() => {
    // Joins a read already under way (the one after this tab's own change); a disabled query is not read.
    if (behind) void queryClient.refetchQueries({ queryKey: adminKeys.visitCandidates(visit.id), exact: true, type: "active" }, { cancelRefetch: false });
  }, [behind, queryClient, visit.id]);

  const fromSummary = summary && !behind ? summary : null;
  const assigned = fromSummary?.workers.map((w) => ({ id: w.id, name: w.display_name })) ?? visit.assignments.map((a) => ({ id: a.worker_id, name: a.display_name }));
  const missing = fromSummary?.missing ?? Math.max(0, required - assigned.length);

  const [unassigning, setUnassigning] = useState<{ id: number; name: string } | null>(null);
  const [replacing, setReplacing] = useState<{ id: number; name: string } | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  // Assigning the last cleaners removes the picker, removing one removes its row: focus goes to the visit's heading.
  const [heading, setHeading] = useState<HTMLHeadingElement | null>(null);
  useFocusRescue(heading, `${assigned.map((w) => w.id).join(",")}:${missing}:${visit.status}`);

  return (
    <section aria-labelledby={`visit-${visit.id}`} className="flex flex-col gap-3 rounded-md border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <h3 ref={setHeading} id={`visit-${visit.id}`} tabIndex={-1} className="font-bold text-ink-900 outline-none">
            {t("visit", { date: text.dateShort(visit.service_date) })} · <SlotLabel start={visit.start} end={visit.end} />
          </h3>
          <span className="text-sm text-ink-600">{t("count", { assigned: assigned.length, required })}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={visitTone[visit.status] ?? "neutral"}>{text.visit(visit.status, visit.status_label)}</StatusBadge>
          {canManage && booking.status === "confirmed" && LIVE_VISIT.includes(visit.status) && (
            <Button variant="ghost" size="sm" onClick={() => setStatusOpen(true)} icon={<Activity aria-hidden className="size-4" />}>
              {t("changeStatus")}
            </Button>
          )}
        </div>
      </div>

      {assigned.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
          {assigned.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="font-medium text-ink-900">{w.name}</span>
              {canManage && (
                <span className="flex gap-1">
                  {assignable && (
                    <Button variant="ghost" size="sm" onClick={() => setReplacing(w)} icon={<Repeat aria-hidden className="size-4" />} aria-label={t("replaceLabel", { name: w.name })}>
                      {t("replace")}
                    </Button>
                  )}
                  {CLEARABLE_VISIT.includes(visit.status) && (
                    <Button variant="ghost" size="sm" className="text-danger-700" onClick={() => setUnassigning(w)} icon={<UserMinus aria-hidden className="size-4" />} aria-label={t("unassignLabel", { name: w.name })}>
                      {t("unassign")}
                    </Button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-600">{t("nobody")}</p>
      )}

      {assignable && missing > 0 && canSeeCandidates && (
        <>
          {candidates.isPending || (behind && candidates.isFetching) ? (
            <LoadingBlock lines={3} />
          ) : candidates.isError ? (
            <ErrorState error={candidates.error} onRetry={() => void candidates.refetch()} className="py-4" />
          ) : (
            <CandidatePicker booking={booking} visitId={visit.id} data={candidates.data} missing={missing} canAssign={canManage} focusFallback={heading} />
          )}
        </>
      )}
      {!assignable && visit.status !== "cancelled" && missing > 0 && <p className="text-sm text-ink-600">{t("notAssignable")}</p>}

      {unassigning && (
        <UnassignDialog visitId={visit.id} version={summary?.version ?? null} worker={unassigning} returnFocusTo={heading} onClose={() => setUnassigning(null)} />
      )}
      {replacing && candidates.data && (
        <ReplaceDialog visitId={visit.id} data={candidates.data} worker={replacing} returnFocusTo={heading} onClose={() => setReplacing(null)} />
      )}
      {statusOpen && <VisitStatusDialog visitId={visit.id} version={summary?.version ?? null} returnFocusTo={heading} onClose={() => setStatusOpen(false)} />}
    </section>
  );
}

/** A visit's status and team (worker ids, sorted), to compare the booking's view with the candidates'. */
function teamKey(status: string, workerIds: readonly number[]): string {
  return `${status}:${[...workerIds].sort((a, b) => a - b).join(",")}`;
}

function useAfterTeamChange(visitId: number) {
  const queryClient = useQueryClient();
  const refresh = useBookingRefresh();
  return () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.visitCandidates(visitId) });
    refresh();
  };
}

/** Rule codes → our copy (OVERRIDE_REQUIRED lists codes only). */
function useRuleLabel() {
  const t = useTranslations("admin.bookings.assignment.rules");
  return (rule: string) => (t.has(rule) ? t(rule) : rule);
}

/** Ids that tie a candidate row's checkbox to its name, rank, badge and reasons. */
const rowIds = (base: string) => ({ input: `${base}-pick`, rank: `${base}-rank`, badge: `${base}-badge`, reasons: `${base}-reasons` });

function CandidatePicker({
  booking,
  visitId,
  data,
  missing,
  canAssign,
  focusFallback,
}: {
  booking: BookingDetail;
  visitId: number;
  data: VisitCandidates;
  missing: number;
  canAssign: boolean;
  focusFallback: HTMLElement | null;
}) {
  const t = useTranslations("admin.bookings.assignment");
  const text = useBookingText();
  const toast = useToast();
  const pickerId = useId();
  const { can } = useAdminSession();
  const canOverride = can(CAPACITY_OVERRIDE_PERMISSION);
  const after = useAfterTeamChange(visitId);
  const [selected, setSelected] = useState<Selection[]>([]);
  const [override, setOverride] = useState<{ selection: Selection[]; rules: { name: string; rules: string[] }[] } | null>(null);

  const mutation = useMutation({
    mutationFn: ({ ids, reason }: { ids: number[]; reason?: string }) =>
      assignWorkers(visitId, ids, data.visit.version, reason ? { override: true, reason } : {}),
    onSuccess: () => {
      toast.success(t("assigned", { count: selected.length }));
      setSelected([]);
      setOverride(null);
      after();
    },
    onError: (error) => {
      const required = overrideRequiredOf(error);
      if (required) {
        const names = new Map(selected.map((s) => [s.id, s.name]));
        setOverride({ selection: selected, rules: required.workers.map((w) => ({ name: names.get(w.workerId) ?? `#${w.workerId}`, rules: w.rules })) });
        return;
      }
      if (error instanceof AdminApiError && (error.code === "STALE_VERSION" || error.code === "TEAM_COMPLETE")) after();
    },
  });

  const toggle = (s: Selection) =>
    setSelected((list) => (list.some((x) => x.id === s.id) ? list.filter((x) => x.id !== s.id) : list.length >= missing ? list : [...list, s]));
  const isSelected = (id: number) => selected.some((s) => s.id === id);

  const assign = () => {
    const needsOverride = selected.filter((s) => s.needsOverride);
    if (needsOverride.length > 0) {
      setOverride({ selection: selected, rules: needsOverride.map((s) => ({ name: s.name, rules: s.rules })) });
      return;
    }
    mutation.mutate({ ids: selected.map((s) => s.id) });
  };

  const preferredId = booking.preferred_worker?.id ?? data.preferred_worker?.id ?? null;
  const shortfalls = readShortfalls(mutation.error);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-ink-900">{t("candidates")}</h4>
        <span className="text-sm text-ink-600">{t("choose", { count: missing })}</span>
      </div>
      {data.candidates.length === 0 ? (
        <p className="text-sm text-ink-600">{t("noCandidates")}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {data.candidates.map((c) => {
            const ids = rowIds(`${pickerId}-c${c.worker.id}`);
            const preferred = c.preferred || c.worker.id === preferredId;
            return (
              // The whole row is the hit area: the name's label stretches over it (after:inset-0).
              <li key={c.worker.id} className="relative flex items-start gap-3 rounded-md border border-line p-3 has-[:checked]:border-petrol-700 has-[:checked]:bg-petrol-50/50">
                {canAssign && (
                  <input
                    id={ids.input}
                    type="checkbox"
                    aria-label={t("pick", { name: c.worker.display_name })}
                    aria-describedby={[ids.rank, preferred ? ids.badge : null, ids.reasons].filter(Boolean).join(" ")}
                    checked={isSelected(c.worker.id)}
                    disabled={!isSelected(c.worker.id) && selected.length >= missing}
                    onChange={() => toggle({ id: c.worker.id, name: c.worker.display_name, needsOverride: false, rules: [] })}
                    className="mt-1 size-4.5 shrink-0 accent-petrol-700"
                  />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span id={ids.rank} className="font-latin text-xs text-ink-600">
                      {t("rank", { rank: c.rank })}
                    </span>
                    {canAssign ? (
                      <label htmlFor={ids.input} className="cursor-pointer font-bold text-ink-900 after:absolute after:inset-0 after:rounded-md">
                        {c.worker.display_name}
                      </label>
                    ) : (
                      <span className="font-bold text-ink-900">{c.worker.display_name}</span>
                    )}
                    {preferred && (
                      <StatusBadge tone="confirmed">
                        <span id={ids.badge}>{t("preferredBadge")}</span>
                      </StatusBadge>
                    )}
                  </div>
                  <ul id={ids.reasons} className="flex flex-col gap-0.5 text-sm text-ink-600">
                    {c.reasons.map((r) => (
                      <li key={r.code}>{text.name(r.label)}</li>
                    ))}
                  </ul>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {data.excluded.length > 0 && (
        <details className="rounded-md border border-line p-3">
          <summary className="cursor-pointer text-sm font-bold text-ink-900">{t("excluded", { count: data.excluded.length })}</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {data.excluded.map((e) => {
              const selectable = canAssign && canOverride && e.overridable;
              const ids = rowIds(`${pickerId}-x${e.worker.id}`);
              return (
                <li key={e.worker.id} className={clsx("relative flex items-start gap-3 rounded-md", selectable && "p-2 has-[:checked]:bg-petrol-50/50")}>
                  {selectable && (
                    <input
                      id={ids.input}
                      type="checkbox"
                      aria-label={t("pickOverride", { name: e.worker.display_name })}
                      aria-describedby={`${ids.badge} ${ids.reasons}`}
                      checked={isSelected(e.worker.id)}
                      disabled={!isSelected(e.worker.id) && selected.length >= missing}
                      onChange={() => toggle({ id: e.worker.id, name: e.worker.display_name, needsOverride: true, rules: e.rules })}
                      className="mt-1 size-4.5 shrink-0 accent-petrol-700"
                    />
                  )}
                  <div className="flex flex-col">
                    <span className="flex flex-wrap items-center gap-2 font-medium text-ink-900">
                      {selectable ? (
                        <label htmlFor={ids.input} className="cursor-pointer after:absolute after:inset-0 after:rounded-md">
                          {e.worker.display_name}
                        </label>
                      ) : (
                        e.worker.display_name
                      )}
                      <StatusBadge tone={e.overridable ? "pending" : "neutral"}>
                        <span id={ids.badge}>{e.overridable ? t("softRule") : t("hardRule")}</span>
                      </StatusBadge>
                    </span>
                    <span id={ids.reasons} className="text-sm text-ink-600">
                      {e.reasons.map((r) => text.name(r.label)).join(" · ")}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          {!canOverride && data.excluded.some((e) => e.overridable) && <p className="mt-2 text-xs text-ink-600">{t("overrideNeedsPermission")}</p>}
        </details>
      )}

      {canAssign && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={assign} disabled={selected.length !== missing} loading={mutation.isPending && !override} icon={<UserPlus aria-hidden className="size-4" />}>
            {t("assign", { count: missing })}
          </Button>
          {selected.length > 0 && selected.length !== missing && <span className="text-sm text-ink-600">{t("chooseMore", { count: missing - selected.length })}</span>}
        </div>
      )}

      {!override && mutation.error ? <TeamError error={mutation.error} shortfalls={shortfalls} /> : null}

      {override && (
        <OverrideDialog
          rules={override.rules}
          canOverride={canOverride}
          returnFocusTo={focusFallback}
          pending={mutation.isPending}
          error={mutation.error && !overrideRequiredOf(mutation.error) ? mutation.error : null}
          onClose={() => {
            setOverride(null);
            mutation.reset();
          }}
          onConfirm={(reason) => mutation.mutate({ ids: override.selection.map((s) => s.id), reason })}
        />
      )}
    </div>
  );
}

/** RESOURCE_CONFLICT and CAPACITY_SHORTFALL explained (never overridable for an assignment), else the error's copy. */
function TeamError({ error, shortfalls }: { error: unknown; shortfalls: ReturnType<typeof readShortfalls> }) {
  const t = useTranslations("admin.bookings.assignment");
  const describe = useAdminErrorMessage();
  if (error instanceof AdminApiError && error.code === "RESOURCE_CONFLICT") {
    return (
      <div className="flex flex-col gap-2">
        <ResourceConflictNotice error={error} />
        <Notice tone="info">{t("conflictNeverOverride")}</Notice>
      </div>
    );
  }
  if (shortfalls) {
    return (
      <div className="flex flex-col gap-2">
        <Notice tone="danger" title={t("shortfallTitle")}>
          {t("shortfallBody")}
        </Notice>
        <ShortfallTable shortfalls={shortfalls} />
      </div>
    );
  }
  return <Notice tone="danger">{describe(error)}</Notice>;
}

/**
 * Soft rules this team breaks (another zone, the travel buffer): staff with capacity.override confirm with a reason
 * of at least 10 characters (audited as capacity.override). Everyone else is told who can.
 */
function OverrideDialog({
  rules,
  canOverride,
  returnFocusTo,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  rules: { name: string; rules: string[] }[];
  canOverride: boolean;
  returnFocusTo: HTMLElement | null;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const t = useTranslations("admin.bookings.assignment");
  const f = useTranslations("admin.bookings.formErrors");
  const ruleLabel = useRuleLabel();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [field, setField] = useState<HTMLTextAreaElement | null>(null);

  const submit = () => {
    const parsed = assignmentReasonSchema(true).safeParse({ reason });
    if (!parsed.success) {
      showFieldError(() => setReasonError(f(parsed.error.issues[0]?.message ?? "reasonRequired")), field);
      return;
    }
    onConfirm(parsed.data);
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("overrideTitle")}
      description={canOverride ? t("overrideBody") : t("overrideNoPermission")}
      confirmLabel={canOverride ? t("overrideSubmit") : t("close")}
      tone={canOverride ? "danger" : "primary"}
      pending={pending}
      onConfirm={canOverride ? submit : onClose}
      returnFocusTo={returnFocusTo}
    >
      <ul className="flex flex-col gap-1 text-sm">
        {rules.map((r) => (
          <li key={r.name}>
            <span className="font-bold text-ink-900">{r.name}</span>: {r.rules.map(ruleLabel).join(" · ") || t("rules.unknown")}
          </li>
        ))}
      </ul>
      {canOverride && (
        <TextArea
          ref={setField}
          label={t("overrideReason")}
          hint={t("overrideReasonHint")}
          required
          rows={2}
          maxLength={FORCE_REASON_MAX}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setReasonError(null);
          }}
          error={reasonError}
        />
      )}
      {error ? <TeamError error={error} shortfalls={readShortfalls(error)} /> : null}
    </ConfirmDialog>
  );
}

function UnassignDialog({
  visitId,
  version,
  worker,
  returnFocusTo,
  onClose,
}: {
  visitId: number;
  version: number | null;
  worker: { id: number; name: string };
  returnFocusTo: HTMLElement | null;
  onClose: () => void;
}) {
  const t = useTranslations("admin.bookings.assignment");
  const f = useTranslations("admin.bookings.formErrors");
  const toast = useToast();
  const after = useAfterTeamChange(visitId);
  const { can } = useAdminSession();
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [field, setField] = useState<HTMLTextAreaElement | null>(null);
  const mutation = useMutation({
    mutationFn: (input: { reason: string; override: boolean }) => unassignWorker(visitId, worker.id, input.reason, version, input.override),
    onSuccess: () => {
      toast.success(t("unassigned", { name: worker.name }));
      after();
      onClose();
    },
  });
  const shortfalls = readShortfalls(mutation.error);
  const mayOverride = !!shortfalls && can(CAPACITY_OVERRIDE_PERMISSION) && mutation.error instanceof AdminApiError && mutation.error.details.can_override !== false;

  const submit = () => {
    const parsed = assignmentReasonSchema(override).safeParse({ reason });
    if (!parsed.success) {
      showFieldError(() => setReasonError(f(parsed.error.issues[0]?.message ?? "reasonRequired")), field);
      return;
    }
    mutation.mutate({ reason: parsed.data, override });
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("unassignTitle", { name: worker.name })}
      description={t("unassignBody")}
      confirmLabel={override ? t("unassignAnyway") : t("unassign")}
      tone="danger"
      pending={mutation.isPending}
      onConfirm={submit}
      returnFocusTo={returnFocusTo}
    >
      <TextArea
        ref={setField}
        label={t("reason")}
        hint={override ? t("overrideReasonHint") : t("reasonHint")}
        required
        rows={2}
        maxLength={500}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          setReasonError(null);
        }}
        error={reasonError}
      />
      {shortfalls && (
        <>
          <Notice tone="danger" title={t("unassignShortfallTitle")}>
            {mayOverride ? t("unassignShortfallOverride") : t("unassignShortfallBody")}
          </Notice>
          <ShortfallTable shortfalls={shortfalls} />
          {mayOverride && <Checkbox label={t("overrideUnassign")} checked={override} onChange={(e) => setOverride(e.target.checked)} />}
        </>
      )}
      {mutation.error && !shortfalls ? <TeamError error={mutation.error} shortfalls={null} /> : null}
    </ConfirmDialog>
  );
}

function ReplaceDialog({
  visitId,
  data,
  worker,
  returnFocusTo,
  onClose,
}: {
  visitId: number;
  data: VisitCandidates;
  worker: { id: number; name: string };
  returnFocusTo: HTMLElement | null;
  onClose: () => void;
}) {
  const t = useTranslations("admin.bookings.assignment");
  const f = useTranslations("admin.bookings.formErrors");
  const toast = useToast();
  const after = useAfterTeamChange(visitId);
  const ruleLabel = useRuleLabel();
  const { can } = useAdminSession();
  const canOverride = can(CAPACITY_OVERRIDE_PERMISSION);
  const [newWorker, setNewWorker] = useState("");
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [errors, setErrors] = useState<{ worker?: string; reason?: string }>({});
  const [field, setField] = useState<HTMLTextAreaElement | null>(null);

  const options: { worker: CandidateWorker; soft: boolean }[] = [
    ...data.candidates.map((c) => ({ worker: c.worker, soft: false })),
    ...(canOverride ? data.excluded.filter((e) => e.overridable).map((e) => ({ worker: e.worker, soft: true })) : []),
  ].filter((o) => o.worker.id !== worker.id);
  const chosen = options.find((o) => String(o.worker.id) === newWorker);

  const mutation = useMutation({
    mutationFn: (input: { reason: string; override: boolean }) =>
      replaceWorker(visitId, { worker_id: worker.id, new_worker_id: Number(newWorker), reason: input.reason, ...(input.override ? { override: true } : {}) }, data.visit.version),
    onSuccess: () => {
      toast.success(t("replaced", { name: worker.name }));
      after();
      onClose();
    },
  });
  const required = overrideRequiredOf(mutation.error);
  const useOverride = override || !!chosen?.soft;

  const submit = () => {
    const next: { worker?: string; reason?: string } = {};
    if (!newWorker) next.worker = f("required");
    const parsed = assignmentReasonSchema(useOverride).safeParse({ reason });
    if (!parsed.success) next.reason = f(parsed.error.issues[0]?.message ?? "reasonRequired");
    if (next.worker || next.reason || !parsed.success) {
      showFieldError(() => setErrors(next), next.worker ? null : field);
      return;
    }
    setErrors({});
    mutation.mutate({ reason: parsed.data, override: useOverride });
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("replaceTitle", { name: worker.name })}
      description={t("replaceBody")}
      confirmLabel={t("replaceSubmit")}
      pending={mutation.isPending}
      onConfirm={submit}
      returnFocusTo={returnFocusTo}
    >
      <Select
        label={t("newWorker")}
        required
        placeholder={t("chooseWorker")}
        value={newWorker}
        onChange={(e) => {
          setNewWorker(e.target.value);
          setErrors((x) => ({ ...x, worker: undefined }));
        }}
        options={options.map((o) => ({ value: String(o.worker.id), label: o.soft ? t("softOption", { name: o.worker.display_name }) : o.worker.display_name }))}
        error={errors.worker}
      />
      {chosen?.soft && <Notice tone="warning">{t("softChosen")}</Notice>}
      <TextArea
        ref={setField}
        label={t("reason")}
        hint={useOverride ? t("overrideReasonHint") : t("reasonHint")}
        required
        rows={2}
        maxLength={500}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          setErrors((x) => ({ ...x, reason: undefined }));
        }}
        error={errors.reason}
      />
      {required && (
        <Notice tone="warning" title={t("overrideTitle")}>
          <ul>
            {required.workers.map((w) => (
              <li key={w.workerId}>{w.rules.map(ruleLabel).join(" · ")}</li>
            ))}
          </ul>
          {canOverride ? (
            <Checkbox label={t("overrideReplace")} checked={override} onChange={(e) => setOverride(e.target.checked)} />
          ) : (
            <p>{t("overrideNoPermission")}</p>
          )}
        </Notice>
      )}
      {mutation.error && !required ? <TeamError error={mutation.error} shortfalls={readShortfalls(mutation.error)} /> : null}
    </ConfirmDialog>
  );
}

/** Operations override of a visit's status (D-01): the driver usually records these; the reason is audited. */
function VisitStatusDialog({
  visitId,
  version,
  returnFocusTo,
  onClose,
}: {
  visitId: number;
  version: number | null;
  returnFocusTo: HTMLElement | null;
  onClose: () => void;
}) {
  const t = useTranslations("admin.bookings.visitStatus");
  const f = useTranslations("admin.bookings.formErrors");
  const text = useBookingText();
  const toast = useToast();
  const after = useAfterTeamChange(visitId);
  const form = useForm<VisitStatusValues>({ resolver: zodResolver(visitStatusSchema) as never, defaultValues: { status: "", reason: "", date: "", time: "" } });
  const status = useWatch({ control: form.control, name: "status" });
  const mutation = useMutation({
    mutationFn: (input: { status: (typeof VISIT_STATUS_TARGETS)[number]; reason: string; at: string | null }) => setVisitStatus(visitId, input, version),
    onSuccess: () => {
      toast.success(t("done"));
      after();
      onClose();
    },
    onError: (error) => applyFieldErrors(error, form.setError, ["status", "reason", "time"], { at: "time" }),
  });
  const errors = form.formState.errors;
  const msg = (e: { message?: string; type?: string } | undefined) => (e?.message ? (e.type === "server" ? e.message : f(e.message)) : undefined);
  const timeReason = mutation.error instanceof AdminApiError && mutation.error.code === "INVALID_STATUS_TIME" ? String(mutation.error.details.reason ?? "") : null;

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title")}
      description={t("body")}
      confirmLabel={t("submit")}
      pending={mutation.isPending}
      onConfirm={() => void form.handleSubmit((v) => mutation.mutate(v as never))()}
      returnFocusTo={returnFocusTo}
    >
      <Select
        label={t("status")}
        required
        placeholder={t("chooseStatus")}
        options={VISIT_STATUS_TARGETS.map((s) => ({ value: s, label: text.visit(s) }))}
        error={msg(errors.status)}
        {...form.register("status")}
      />
      {status === "missed_by_company" && <Notice tone="warning">{t("missedNote")}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField type="date" label={t("date")} dir="ltr" className="font-latin text-start" {...form.register("date")} />
        <TextField type="time" label={t("time")} hint={t("timeHint")} dir="ltr" className="font-latin text-start" error={msg(errors.time)} {...form.register("time")} />
      </div>
      <TextArea label={t("reason")} required rows={2} maxLength={500} error={msg(errors.reason)} {...form.register("reason")} />
      {timeReason ? (
        <Notice tone="danger">{t.has(`timeErrors.${timeReason}`) ? t(`timeErrors.${timeReason}`) : t("timeErrors.other")}</Notice>
      ) : mutation.error && !(mutation.error instanceof AdminApiError && mutation.error.code === "VALIDATION_FAILED") ? (
        <TeamError error={mutation.error} shortfalls={null} />
      ) : null}
      <p className="flex items-center gap-1.5 text-xs text-ink-600">
        <ShieldAlert aria-hidden className="size-3.5" />
        {t("audited")}
      </p>
    </ConfirmDialog>
  );
}
