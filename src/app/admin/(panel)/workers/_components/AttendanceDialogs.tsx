"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button, ConfirmDialog, Dialog, Notice, Select, TextArea, TextField, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { businessToday, isolate } from "@/lib/admin/format";
import {
  attendanceFormFrom,
  dayActions,
  dayVersion,
  hasEvidence,
  noteRequired,
  readEvidence,
  validateAttendanceForm,
  type AttendanceErrors,
  type AttendanceForm,
} from "@/lib/admin/workforce/attendance";
import { recordAttendance, revertAttendance } from "@/lib/admin/workforce/endpoints";
import { useApiFieldMessage, useWorkforceError } from "@/lib/admin/workforce/errors";
import { workforceKeys } from "@/lib/admin/workforce/keys";
import { useWorkforceText } from "@/lib/admin/workforce/text";
import type { AttendanceDay } from "@/lib/admin/workforce/types";
import { useSeenRecord } from "../../finance/_components/useSeenRecord";

/**
 * After an attendance write: every month and day sheet that shows it, the worker's stats, and the incentive proposals (the
 * API marks the month's proposal stale in the same transaction, so the proposals page must read it again).
 */
export function useAttendanceRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: workforceKeys.attendanceAll() });
    void queryClient.invalidateQueries({ queryKey: ["admin", "workers", "attendance"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "workers", "stats"] });
    void queryClient.invalidateQueries({ queryKey: workforceKeys.incentives() });
  };
}

/** The evidence the nightly derivation found for a day: visits, rounds, pickups, Live-out and released assignments. */
export function EvidenceList({ day }: { day: AttendanceDay }) {
  const t = useTranslations("admin.workers.attendance.evidence");
  const wt = useWorkforceText();
  const e = readEvidence(day.evidence);
  if (!hasEvidence(e)) return <p className="text-sm text-ink-600">{t("none")}</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm text-ink-900">
      {e.visits.map((v) => (
        <li key={`v${v.id}`}>{t("visit", { reference: isolate(v.reference, "ltr"), status: v.status })}</li>
      ))}
      {e.rounds.map((r) => (
        <li key={`r${r.id}`}>{t("round", { kind: r.kind, time: r.departedAt ? wt.time(r.departedAt) : "—" })}</li>
      ))}
      {e.pickups > 0 && <li>{t("pickups", { count: e.pickups })}</li>}
      {e.liveOut && <li>{t("liveOut")}</li>}
      {e.released.map((r) => (
        <li key={`x${r.visitId}`}>{t("released", { reason: wt.releaseReason(r.reason) })}</li>
      ))}
    </ul>
  );
}

/**
 * Records, changes or corrects one worker's day (attendance.manage, workforce §3.2, §5.4): present, absent, late or half
 * day with a note where the API needs one, the minutes of a late arrival and the check-in and check-out as Dubai times
 * (sent with their offset, P5-W88). The dialog works on a copy of the day (useSeenRecord) and sends its row version as
 * If-Match (0 for a day with no stored row); after a 409 STALE_VERSION it shows what is saved now, keeps what was typed
 * and asks again. A manual row always wins over the nightly derivation.
 */
export function AttendanceDialog({ day, live, onClose }: { day: AttendanceDay; live: AttendanceDay | null; onClose: () => void }) {
  const t = useTranslations("admin.workers.attendance");
  const e = useTranslations("admin.workers.attendance.errors");
  const toast = useToast();
  const describe = useWorkforceError();
  const wt = useWorkforceText();
  const refresh = useAttendanceRefresh();
  const formId = useId();
  const seen = useSeenRecord(live ?? day);
  const record = seen.record;
  const [form, setForm] = useState<AttendanceForm>(() => attendanceFormFrom(day));
  const [errors, setErrors] = useState<AttendanceErrors>({});
  const actions = dayActions(record, businessToday());
  const gone = live === null;
  const set = <K extends keyof AttendanceForm>(key: K, value: AttendanceForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((x) => ({ ...x, [key]: undefined }));
  };

  const save = useMutation({
    mutationFn: async () => {
      const checked = validateAttendanceForm(form, record.date);
      if (!checked.ok) throw new FormProblem(checked.errors);
      seen.seen();
      return recordAttendance(record.worker.id, record.date, checked.input, dayVersion(record));
    },
    onSuccess: () => {
      refresh();
      toast.success(t("saved"));
      onClose();
    },
    onError: (error) => {
      if (error instanceof FormProblem) return setErrors(error.errors);
      refresh();
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") seen.moved();
    },
  });
  const apiField = useApiFieldMessage(save.error);
  const fieldError = (field: keyof AttendanceForm, fallbackKey: string) => (errors[field] ? e(errors[field]!) : apiField(field === "check_in" ? "check_in_at" : field === "check_out" ? "check_out_at" : field, e(fallbackKey)));
  const name = isolate(record.worker.display_name);
  const stale = seen.waiting || seen.renewed;
  const absentLiveOut = record.live_out !== null && (form.status === "absent" || form.status === "late");

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !save.isPending && onClose()}
      title={t("dialogTitle", { name })}
      description={t("dialogBody", { date: wt.dateLong(record.date) })}
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t("cancel")}
          </Button>
          <Button type="submit" form={formId} loading={save.isPending} disabled={!actions.canRecord || gone || seen.waiting}>
            {t("save")}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(ev) => { ev.preventDefault(); save.mutate(); }} className="flex flex-col gap-4">
        {gone && <Notice tone="danger">{t("dayGone")}</Notice>}
        {stale && !gone && <Notice tone="warning">{seen.renewed ? t("movedRenewed") : t("movedWaiting")}</Notice>}
        {record.locked && <Notice tone="warning">{t("lockedNote")}</Notice>}
        {record.leave !== null && <Notice tone="info">{t("onLeaveNote")}</Notice>}
        {!record.expected && record.leave === null && <Notice tone="info">{t("notExpectedNote")}</Notice>}
        {record.conflicts_with_evidence && <Notice tone="warning">{t("conflictNote")}</Notice>}
        <Select
          label={t("fields.status")}
          required
          placeholder={t("fields.statusChoose")}
          disabled={!actions.canRecord}
          value={form.status}
          onChange={(ev) => set("status", ev.target.value)}
          options={actions.statuses.map((s) => ({ value: s, label: wt.attendanceStatus(s) }))}
          error={fieldError("status", "statusRequired")}
        />
        {form.status === "late" && (
          <TextField label={t("fields.lateMinutes")} required inputMode="numeric" dir="ltr" className="font-latin text-start" disabled={!actions.canRecord} value={form.late_minutes} onChange={(ev) => set("late_minutes", ev.target.value)} error={fieldError("late_minutes", "lateMinutes")} hint={t("fields.lateHint")} />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t("fields.checkIn")} type="time" dir="ltr" disabled={!actions.canRecord} value={form.check_in} onChange={(ev) => set("check_in", ev.target.value)} error={fieldError("check_in", "timeInvalid")} />
          <TextField label={t("fields.checkOut")} type="time" dir="ltr" disabled={!actions.canRecord} value={form.check_out} onChange={(ev) => set("check_out", ev.target.value)} error={fieldError("check_out", "checkOrder")} />
        </div>
        <TextArea
          label={t("fields.note")}
          required={noteRequired(form.status)}
          rows={2}
          maxLength={500}
          disabled={!actions.canRecord}
          value={form.note}
          onChange={(ev) => set("note", ev.target.value)}
          error={fieldError("note", "noteRequired")}
          hint={noteRequired(form.status) ? t("fields.noteRequiredHint") : undefined}
        />
        {absentLiveOut && record.live_out && (
          <Notice tone="info">
            {t("liveOutNote")}{" "}
            <Link href={`/admin/subscriptions/${record.live_out.subscription_id}`} className="font-bold">
              {t("liveOutLink", { reference: isolate(record.live_out.reference, "ltr") })}
            </Link>
          </Notice>
        )}
        <details className="rounded-md border border-line p-3">
          <summary className="cursor-pointer text-sm font-bold text-ink-900">{t("evidence.title")}</summary>
          <div className="mt-2">
            <EvidenceList day={record} />
          </div>
        </details>
        {save.error && !(save.error instanceof FormProblem) && !stale && <Notice tone="danger">{describe(save.error)}</Notice>}
      </form>
    </Dialog>
  );
}

class FormProblem extends Error {
  constructor(readonly errors: AttendanceErrors) {
    super("form");
  }
}

/** Takes a manual row back to what the nightly derivation finds (DELETE, If-Match): a past day is derived at once, today's stays a draft. */
export function RevertAttendanceDialog({ day, live, onClose }: { day: AttendanceDay; live: AttendanceDay | null; onClose: () => void }) {
  const t = useTranslations("admin.workers.attendance");
  const toast = useToast();
  const describe = useWorkforceError();
  const wt = useWorkforceText();
  const refresh = useAttendanceRefresh();
  const seen = useSeenRecord(live ?? day);
  const record = seen.record;
  const revert = useMutation({
    mutationFn: () => revertAttendance(record.worker.id, record.date, dayVersion(record)),
    onSuccess: () => {
      refresh();
      toast.success(t("reverted"));
      onClose();
    },
    onError: (error) => {
      refresh();
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") seen.moved();
    },
  });
  const stale = seen.waiting || seen.renewed;
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("revertTitle", { name: isolate(record.worker.display_name) })}
      description={t("revertBody", { date: wt.dateLong(record.date) })}
      confirmLabel={t("revert")}
      pending={revert.isPending}
      onConfirm={() => {
        if (seen.waiting || live === null) return;
        seen.seen();
        revert.mutate();
      }}
    >
      {live === null && <Notice tone="danger">{t("dayGone")}</Notice>}
      {stale && live !== null && <Notice tone="warning">{seen.renewed ? t("movedRenewed") : t("movedWaiting")}</Notice>}
      {revert.error && !stale && <Notice tone="danger">{describe(revert.error)}</Notice>}
    </ConfirmDialog>
  );
}
