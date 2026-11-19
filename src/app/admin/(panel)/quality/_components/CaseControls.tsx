"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Checkbox, CheckboxGroup, Notice, Select, useToast } from "@/components/admin";
import { useAdminSession } from "@/lib/admin/session";
import { fetchAssignees, updateCase, type CasePatch } from "@/lib/admin/quality/endpoints";
import { useQualityError } from "@/lib/admin/quality/errors";
import { useQualityText } from "@/lib/admin/quality/labels";
import { qualityKeys } from "@/lib/admin/quality/keys";
import { CASE_CATEGORIES, CASE_PRIORITIES, type AdminCaseDetail, type Assignee } from "@/lib/admin/quality/types";
import { isStaleVersion, useCaseRefresh } from "./useCaseRefresh";

/**
 * One edit of a case: the field's change and the case's version as If-Match. A 409 STALE_VERSION means someone changed
 * the case meanwhile: nothing is saved, the case is read again and the person is told so (`stale`).
 */
export function useCasePatch(c: AdminCaseDetail, onDone?: (answer: AdminCaseDetail) => void) {
  const t = useTranslations("admin.quality.case");
  const refresh = useCaseRefresh();
  const toast = useToast();
  const [stale, setStale] = useState(false);
  const mutation = useMutation({
    mutationFn: (patch: CasePatch) => updateCase(c.id, patch, c.version),
    onSuccess: (answer) => {
      setStale(false);
      refresh(answer);
      toast.success(t("saved"));
      onDone?.(answer);
    },
    onError: (error) => {
      if (isStaleVersion(error)) {
        setStale(true);
        refresh();
      }
    },
  });
  return { ...mutation, stale, clearStale: () => setStale(false) };
}

/** Who holds the case: a select over the staff who handle quality, and "Assign to me". */
export function AssignControl({ c }: { c: AdminCaseDetail }) {
  const t = useTranslations("admin.quality.case");
  const describe = useQualityError();
  const { me } = useAdminSession();
  const assignees = useQuery({ queryKey: qualityKeys.assignees(), queryFn: fetchAssignees, staleTime: 5 * 60_000, enabled: c.actions.assign });
  const patch = useCasePatch(c);
  const list: Assignee[] = assignees.data ?? [];
  // A current assignee who no longer holds the permission stays in the list so the select shows who it is.
  const options = c.assignee && !list.some((a) => a.id === c.assignee?.id) ? [...list, { id: c.assignee.id, name: c.assignee.name, roles: [] }] : list;
  const mine = me?.id !== undefined && c.assignee?.id === me.id;
  const canTake = c.actions.assign && me?.id !== undefined && !mine && list.some((a) => a.id === me.id);

  if (!c.actions.assign) {
    return (
      <p className="text-sm">
        <span className="text-ink-600">{t("assignee")}: </span>
        <span className="font-medium text-ink-900">{c.assignee?.name ?? t("unassigned")}</span>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <Select
          label={t("assignee")}
          placeholder={t("unassigned")}
          value={c.assignee ? String(c.assignee.id) : ""}
          disabled={patch.isPending || assignees.isPending}
          onChange={(e) => patch.mutate({ assignee_id: e.target.value === "" ? null : Number(e.target.value) })}
          options={options.map((a) => ({ value: String(a.id), label: a.name }))}
          containerClassName="min-w-[200px]"
        />
        {canTake && (
          <Button variant="secondary" onClick={() => patch.mutate({ assignee_id: me!.id })} loading={patch.isPending}>
            {t("takeIt")}
          </Button>
        )}
      </div>
      {assignees.isError && <Notice tone="warning">{describe(assignees.error)}</Notice>}
      <PatchNotice patch={patch} />
    </div>
  );
}

export function PatchNotice({ patch }: { patch: ReturnType<typeof useCasePatch> }) {
  const t = useTranslations("admin.quality.case");
  const describe = useQualityError();
  if (patch.stale) {
    return (
      <Notice tone="warning" title={t("staleTitle")}>
        {t("staleBody")}
      </Notice>
    );
  }
  return patch.isError ? <Notice tone="danger">{describe(patch.error)}</Notice> : null;
}

/** Priority, category, the workers and the driver the case is about (complaints.manage, not closed). */
export function CaseSettings({ c }: { c: AdminCaseDetail }) {
  const t = useTranslations("admin.quality.case");
  const text = useQualityText();
  const patch = useCasePatch(c);
  const editable = c.actions.assign;
  const [workers, setWorkers] = useState<string[]>(() => c.workers.map((w) => String(w.id)));
  // The list follows the case after a read (another person's change, our own save): adjusted while rendering, not in an effect.
  const named = c.workers.map((w) => w.id).sort((a, b) => a - b).join(",");
  const [syncedTo, setSyncedTo] = useState(named);
  if (syncedTo !== named) {
    setSyncedTo(named);
    setWorkers(c.workers.map((w) => String(w.id)));
  }
  const workersChanged = [...workers].map(Number).sort((a, b) => a - b).join(",") !== named;

  return (
    <div className="flex flex-col gap-3">
      <Select
        label={t("priority")}
        value={c.priority}
        disabled={!editable || patch.isPending}
        onChange={(e) => patch.mutate({ priority: e.target.value as AdminCaseDetail["priority"] })}
        options={CASE_PRIORITIES.map((p) => ({ value: p, label: text.priority(p) }))}
      />
      <Select
        label={t("category")}
        value={c.category}
        disabled={!editable || patch.isPending}
        onChange={(e) => patch.mutate({ category: e.target.value as AdminCaseDetail["category"] })}
        options={CASE_CATEGORIES.map((p) => ({ value: p, label: text.category(p) }))}
      />
      {c.worker_options.length > 0 && (
        <div className="flex flex-col gap-2">
          <CheckboxGroup legend={t("workers")} hint={t("workersHint")}>
            {c.worker_options.map((w) => (
              <Checkbox
                key={w.id}
                label={w.released ? t("workerReleased", { name: w.name }) : w.name}
                checked={workers.includes(String(w.id))}
                disabled={!editable || patch.isPending}
                onChange={(e) => setWorkers((list) => (e.target.checked ? [...list, String(w.id)] : list.filter((x) => x !== String(w.id))))}
              />
            ))}
          </CheckboxGroup>
          {editable && workersChanged && (
            <Button size="sm" variant="secondary" className="self-start" loading={patch.isPending} onClick={() => patch.mutate({ worker_ids: workers.map(Number) })}>
              {t("saveWorkers")}
            </Button>
          )}
        </div>
      )}
      {c.driver_options.length > 0 && (
        <Select
          label={t("driver")}
          placeholder={t("noDriver")}
          value={c.driver ? String(c.driver.id) : ""}
          disabled={!editable || patch.isPending}
          onChange={(e) => patch.mutate({ driver_id: e.target.value === "" ? null : Number(e.target.value) })}
          options={c.driver_options.map((d) => ({ value: String(d.id), label: d.name ?? `#${d.id}` }))}
        />
      )}
      <PatchNotice patch={patch} />
    </div>
  );
}
