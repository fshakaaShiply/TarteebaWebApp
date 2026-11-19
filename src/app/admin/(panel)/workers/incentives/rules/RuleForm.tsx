"use client";

import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button, Dialog, IconButton, MoneyField, Notice, TextField, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { createRule, updateRule } from "@/lib/admin/workforce/endpoints";
import { useWorkforceError } from "@/lib/admin/workforce/errors";
import { emptyRuleForm, MAX_TIERS, ruleServerErrors, ruleToForm, SCORE_KEYS, validateRuleForm, type RuleErrors, type RuleFieldKey, type RuleForm as RuleFormValues } from "@/lib/admin/workforce/incentives";
import { useWorkforceText } from "@/lib/admin/workforce/text";
import type { IncentiveRule } from "@/lib/admin/workforce/types";
import { useIncentiveRefresh } from "../_components/ProposalDialogs";
import { useSeenRecord } from "../../../finance/_components/useSeenRecord";

/**
 * Creates or edits an incentive rule (workforce §2.4, §3.4, §5.6; HR edits it here with incentives.approve, P5-W20). The
 * scheme has four weights (a share of the score), thresholds (the hours target and minimum as hours, the rating floor as
 * stars, how many ratings count, the most absent days) and amount tiers (a score from which an amount is paid). Hours,
 * percent and AED are typed as people read them and converted by integer parsing. An edit keeps past proposals as they
 * were (each holds a snapshot); the next compute uses the new version. A rule is created inactive.
 */
export function RuleFormDialog({ rule, live, onClose }: { rule: IncentiveRule | null; live: IncentiveRule | null; onClose: () => void }) {
  const t = useTranslations("admin.incentives.rules");
  const e = useTranslations("admin.incentives.rules.errors");
  const toast = useToast();
  const describe = useWorkforceError();
  const wt = useWorkforceText();
  const refresh = useIncentiveRefresh();
  const formId = useId();
  const seen = useSeenRecord(live ?? rule ?? ({ version: 0 } as IncentiveRule));
  const [form, setForm] = useState<RuleFormValues>(() => (rule ? ruleToForm(rule) : emptyRuleForm()));
  const [errors, setErrors] = useState<RuleErrors>({});
  const gone = rule !== null && live === null;
  const stale = rule !== null && (seen.waiting || seen.renewed);
  const clear = (field: RuleFieldKey) => setErrors((x) => ({ ...x, [field]: undefined }));

  const save = useMutation({
    mutationFn: async () => {
      const checked = validateRuleForm(form);
      if (!checked.ok) throw new FormProblem(checked.errors);
      if (rule) {
        seen.seen();
        return updateRule(rule.id, checked.body, seen.record.version);
      }
      return createRule(checked.body);
    },
    onSuccess: () => {
      refresh();
      toast.success(rule ? t("saved") : t("created"));
      onClose();
    },
    onError: (error) => {
      if (error instanceof FormProblem) return setErrors(error.errors);
      refresh();
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") seen.moved();
    },
  });
  const server = ruleServerErrors(save.error);
  const fieldError = (field: RuleFieldKey): string | undefined => (errors[field] ? e(errors[field]!) : server?.byField[field]);
  const set = (change: Partial<RuleFormValues>) => setForm((f) => ({ ...f, ...change }));

  const setTier = (index: number, change: Partial<RuleFormValues["tiers"][number]>) =>
    setForm((f) => ({ ...f, tiers: f.tiers.map((tier, i) => (i === index ? { ...tier, ...change } : tier)) }));

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !save.isPending && onClose()}
      title={rule ? t("editTitle") : t("createTitle")}
      description={t("formBody")}
      size="lg"
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t("cancel")}
          </Button>
          <Button type="submit" form={formId} loading={save.isPending} disabled={gone || seen.waiting}>
            {t("save")}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(ev) => { ev.preventDefault(); save.mutate(); }} className="flex flex-col gap-5">
        {gone && <Notice tone="danger">{t("gone")}</Notice>}
        {stale && !gone && <Notice tone="warning">{seen.renewed ? t("movedRenewed") : t("movedWaiting")}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t("fields.nameAr")} required dir="rtl" maxLength={100} value={form.name_ar} onChange={(ev) => { set({ name_ar: ev.target.value }); clear("name_ar"); }} error={fieldError("name_ar")} />
          <TextField label={t("fields.nameEn")} required dir="ltr" maxLength={100} value={form.name_en} onChange={(ev) => { set({ name_en: ev.target.value }); clear("name_en"); }} error={fieldError("name_en")} />
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-bold text-ink-900">{t("weightsTitle")}</legend>
          <p className="text-xs text-ink-600">{t("weightsHint")}</p>
          <div className="grid gap-4 sm:grid-cols-4">
            {SCORE_KEYS.map((key) => (
              <TextField
                key={key}
                label={wt.score(key)}
                required
                inputMode="numeric"
                dir="ltr"
                className="font-latin text-start"
                value={form.weights[key]}
                onChange={(ev) => { set({ weights: { ...form.weights, [key]: ev.target.value } }); clear(`weights.${key}`); clear("weights"); }}
                error={fieldError(`weights.${key}`)}
              />
            ))}
          </div>
          {fieldError("weights") && <p role="alert" className="text-xs font-medium text-danger-700">{fieldError("weights")}</p>}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-bold text-ink-900">{t("thresholdsTitle")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t("fields.hoursTarget")} required inputMode="decimal" dir="ltr" className="font-latin text-start" value={form.hours_target} onChange={(ev) => { set({ hours_target: ev.target.value }); clear("hours_target"); }} error={fieldError("hours_target")} hint={t("fields.hoursTargetHint")} />
            <TextField label={t("fields.minHours")} required inputMode="decimal" dir="ltr" className="font-latin text-start" value={form.min_hours} onChange={(ev) => { set({ min_hours: ev.target.value }); clear("min_hours"); }} error={fieldError("min_hours")} hint={t("fields.minHoursHint")} />
            <TextField label={t("fields.ratingFloor")} required inputMode="decimal" dir="ltr" className="font-latin text-start" value={form.rating_floor} onChange={(ev) => { set({ rating_floor: ev.target.value }); clear("rating_floor"); }} error={fieldError("rating_floor")} hint={t("fields.ratingFloorHint")} />
            <TextField label={t("fields.minRatings")} required inputMode="numeric" dir="ltr" className="font-latin text-start" value={form.min_ratings} onChange={(ev) => { set({ min_ratings: ev.target.value }); clear("min_ratings"); }} error={fieldError("min_ratings")} hint={t("fields.minRatingsHint")} />
            <TextField label={t("fields.maxAbsent")} inputMode="numeric" dir="ltr" className="font-latin text-start" value={form.max_absent} onChange={(ev) => { set({ max_absent: ev.target.value }); clear("max_absent"); }} error={fieldError("max_absent")} hint={t("fields.maxAbsentHint")} />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-bold text-ink-900">{t("tiersTitle")}</legend>
          <p className="text-xs text-ink-600">{t("tiersHint")}</p>
          {form.tiers.map((tier, i) => (
            <div key={i} className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <TextField label={t("fields.tierScore", { n: i + 1 })} inputMode="decimal" dir="ltr" className="font-latin text-start" suffix="%" value={tier.min_score} onChange={(ev) => { setTier(i, { min_score: ev.target.value }); clear(`tiers.${i}.min_score`); }} error={fieldError(`tiers.${i}.min_score`)} />
              <MoneyField label={t("fields.tierAmount", { n: i + 1 })} value={tier.amount} onChange={(ev) => { setTier(i, { amount: ev.target.value }); clear(`tiers.${i}.amount`); }} error={fieldError(`tiers.${i}.amount`)} />
              <IconButton label={t("removeTier", { n: i + 1 })} className="mt-7" onClick={() => set({ tiers: form.tiers.filter((_, j) => j !== i) })} disabled={form.tiers.length <= 1}>
                <Trash2 aria-hidden className="size-4" />
              </IconButton>
            </div>
          ))}
          {fieldError("tiers") && <p role="alert" className="text-xs font-medium text-danger-700">{fieldError("tiers")}</p>}
          <Button variant="outline" size="sm" className="self-start" onClick={() => set({ tiers: [...form.tiers, { min_score: "", amount: "" }] })} disabled={form.tiers.length >= MAX_TIERS} icon={<Plus aria-hidden className="size-4" />}>
            {t("addTier")}
          </Button>
        </fieldset>

        {server && server.other.length > 0 && (
          <Notice tone="danger">
            <ul>
              {server.other.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </Notice>
        )}
        {save.error && !(save.error instanceof FormProblem) && !server && !stale && <Notice tone="danger">{describe(save.error)}</Notice>}
      </form>
    </Dialog>
  );
}

class FormProblem extends Error {
  constructor(readonly errors: RuleErrors) {
    super("form");
  }
}
