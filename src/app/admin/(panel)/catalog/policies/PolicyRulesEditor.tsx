"use client";

import { Braces, ListChecks, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import clsx from "clsx";
import {
  Button,
  ChipsInput,
  IconButton,
  Select,
  Switch,
  TextArea,
  TextField,
  controlClasses,
} from "@/components/admin";
import {
  COMPENSATIONS,
  MAX_TIERS,
  REQUIRED_SECTION,
  parseRulesJson,
  rulesFromDraft,
  rulesToJson,
  type RulesDraft,
  type RulesJsonProblem,
  type TierDraft,
} from "@/lib/admin/catalog/policyRules";
import type { PolicyType } from "@/lib/admin/types";
import { useCatalogText, useFieldError } from "../_components/catalogText";

type ErrorNode = { type?: string; message?: string; [key: string]: unknown } | undefined;

/** Reads a nested react-hook-form error (e.g. ["cancellation", "tiers", 1, "fee_value"]). */
function errorAt(errors: unknown, path: (string | number)[]): ErrorNode {
  let node: unknown = errors;
  for (const key of path) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string | number, unknown>)[key];
  }
  return node && typeof node === "object" && "message" in node ? (node as ErrorNode) : undefined;
}

/** The JSON view's problem as text; entry paths are isolated left-to-right inside Arabic copy. */
function useJsonProblemText() {
  const t = useTranslations("admin.catalog.policies.rules");
  return (problem: RulesJsonProblem | null): string | undefined => {
    if (!problem) return undefined;
    if (problem.kind === "syntax") return t("jsonInvalid");
    return t("jsonUnsupported", { paths: `⁦${problem.paths.join(", ")}⁩` });
  };
}

/**
 * Editor for policies.rules (spec §11.4): cancellation tiers, reschedule terms, company cancellation, exceptions, and a
 * JSON view of the same rules. The section the policy type requires is always on. Switching views never changes the
 * rules: JSON the form cannot hold exactly stays in the JSON view with the offending entries listed, and the form
 * opens the JSON view only once its fields validate.
 */
export function PolicyRulesEditor({
  type,
  value,
  onChange,
  errors,
  jsonMode,
  onJsonModeChange,
  jsonText,
  onJsonTextChange,
  jsonProblem,
  onInvalidDraft,
}: {
  type: PolicyType;
  value: RulesDraft;
  onChange: (draft: RulesDraft) => void;
  errors: unknown;
  jsonMode: boolean;
  onJsonModeChange: (on: boolean) => void;
  jsonText: string;
  onJsonTextChange: (text: string) => void;
  /** Set by the policy form when saving from the JSON view failed to parse. */
  jsonProblem: RulesJsonProblem | null;
  /** The form view has invalid fields: show their errors (the JSON view stays closed). */
  onInvalidDraft: () => void;
}) {
  const t = useTranslations("admin.catalog.policies.rules");
  const fieldError = useFieldError();
  const text = useCatalogText();
  const problemText = useJsonProblemText();
  const idPrefix = useId();
  const required = REQUIRED_SECTION[type];
  const err = (...path: (string | number)[]) => fieldError(errorAt(errors, path));
  const [parseProblem, setParseProblem] = useState<RulesJsonProblem | null>(null);
  const [jsonBlocked, setJsonBlocked] = useState(false);
  // Only while the draft still has issues; fixing the fields hides the hint.
  const showJsonBlocked = jsonBlocked && !jsonMode && rulesFromDraft(value, type).issues.length > 0;

  const toggleJson = () => {
    if (jsonMode) {
      const parsed = parseRulesJson(jsonText);
      if (!parsed.ok) {
        setParseProblem(parsed.problem);
        return;
      }
      setParseProblem(null);
      onChange(parsed.draft);
      onJsonModeChange(false);
    } else {
      const result = rulesFromDraft(value, type);
      if (result.issues.length > 0) {
        setJsonBlocked(true);
        onInvalidDraft();
        return;
      }
      setJsonBlocked(false);
      onJsonTextChange(rulesToJson(result.rules));
      onJsonModeChange(true);
    }
  };

  const setTiers = (tiers: TierDraft[]) => onChange({ ...value, cancellation: { ...value.cancellation, tiers } });
  const updateTier = (i: number, patch: Partial<TierDraft>) =>
    setTiers(value.cancellation.tiers.map((tier, j) => (j === i ? { ...tier, ...patch } : tier)));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-ink-900">{t("title")}</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={toggleJson}
          aria-pressed={jsonMode}
          icon={jsonMode ? <ListChecks aria-hidden className="size-4" /> : <Braces aria-hidden className="size-4" />}
        >
          {jsonMode ? t("formView") : t("jsonView")}
        </Button>
      </div>
      {showJsonBlocked && (
        <p role="alert" className="text-xs font-medium text-danger-700">
          {t("fixBeforeJson")}
        </p>
      )}

      {jsonMode ? (
        <>
          <TextArea
            label={t("json")}
            hint={t("jsonHint")}
            dir="ltr"
            rows={16}
            spellCheck={false}
            className="text-start font-mono text-[13px]"
            value={jsonText}
            onChange={(e) => {
              onJsonTextChange(e.target.value);
              setParseProblem(null);
            }}
            error={problemText(parseProblem ?? jsonProblem)}
          />
        </>
      ) : (
        <>
          {/* Cancellation tiers */}
          <section className="flex flex-col gap-3 rounded-md border border-line p-4">
            <Switch
              label={t("cancellation")}
              description={required === "cancellation" ? t("requiredSection") : t("cancellationHint")}
              checked={value.cancellation.enabled || required === "cancellation"}
              disabled={required === "cancellation"}
              onCheckedChange={(on) => onChange({ ...value, cancellation: { ...value.cancellation, enabled: on } })}
            />
            {(value.cancellation.enabled || required === "cancellation") && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse text-sm">
                    <caption className="sr-only">{t("tiersCaption")}</caption>
                    <thead>
                      <tr className="text-ink-600">
                        <th scope="col" className="px-1 py-1.5 text-start font-medium">
                          {t("minHoursBefore")}
                        </th>
                        <th scope="col" className="px-1 py-1.5 text-start font-medium">
                          {t("feeType")}
                        </th>
                        <th scope="col" className="px-1 py-1.5 text-start font-medium">
                          {t("feeValue")}
                        </th>
                        <th scope="col" className="px-1 py-1.5">
                          <span className="sr-only">{t("remove")}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {value.cancellation.tiers.map((tier, i) => {
                        const hoursError = err("cancellation", "tiers", i, "min_hours_before");
                        const feeError = err("cancellation", "tiers", i, "fee_value");
                        const hoursErrorId = `${idPrefix}-tier-${i}-hours-error`;
                        const feeErrorId = `${idPrefix}-tier-${i}-fee-error`;
                        return (
                          <tr key={i} className="border-t border-line align-top">
                            <td className="px-1 py-2">
                              <input
                                aria-label={t("tierHours", { n: i + 1 })}
                                inputMode="numeric"
                                dir="ltr"
                                value={tier.min_hours_before}
                                onChange={(e) => updateTier(i, { min_hours_before: e.target.value })}
                                aria-invalid={hoursError ? true : undefined}
                                aria-describedby={hoursError ? hoursErrorId : undefined}
                                className={clsx(controlClasses, "h-10 text-start font-latin")}
                              />
                              {hoursError && (
                                <p id={hoursErrorId} className="mt-1 text-xs font-medium text-danger-700">
                                  {hoursError}
                                </p>
                              )}
                            </td>
                            <td className="px-1 py-2">
                              <select
                                aria-label={t("tierType", { n: i + 1 })}
                                value={tier.fee_type}
                                onChange={(e) => updateTier(i, { fee_type: e.target.value === "fixed" ? "fixed" : "percent", fee_value: "" })}
                                className={clsx(controlClasses, "h-10 pe-8")}
                              >
                                <option value="percent">{t("percent")}</option>
                                <option value="fixed">{t("fixed")}</option>
                              </select>
                            </td>
                            <td className="px-1 py-2">
                              <div className="relative">
                                <input
                                  aria-label={t("tierFee", { n: i + 1 })}
                                  inputMode="decimal"
                                  dir="ltr"
                                  value={tier.fee_value}
                                  onChange={(e) => updateTier(i, { fee_value: e.target.value })}
                                  aria-invalid={feeError ? true : undefined}
                                  aria-describedby={feeError ? feeErrorId : undefined}
                                  className={clsx(controlClasses, "h-10 pe-12 text-start font-latin")}
                                />
                                <span aria-hidden className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-ink-600">
                                  {tier.fee_type === "percent" ? "%" : t("currency")}
                                </span>
                              </div>
                              {feeError && (
                                <p id={feeErrorId} className="mt-1 text-xs font-medium text-danger-700">
                                  {feeError}
                                </p>
                              )}
                            </td>
                            <td className="px-1 py-2 text-end">
                              <IconButton
                                label={t("removeTier", { n: i + 1 })}
                                onClick={() => setTiers(value.cancellation.tiers.filter((_, j) => j !== i))}
                                className="text-danger-700"
                              >
                                <Trash2 aria-hidden className="size-4" />
                              </IconButton>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {err("cancellation", "tiers") && <p className="text-xs font-medium text-danger-700">{err("cancellation", "tiers")}</p>}
                <p className="text-xs text-ink-600">{t("tiersHint")}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  disabled={value.cancellation.tiers.length >= MAX_TIERS}
                  onClick={() => setTiers([...value.cancellation.tiers, { min_hours_before: "", fee_type: "percent", fee_value: "" }])}
                  icon={<Plus aria-hidden className="size-4" />}
                >
                  {t("addTier")}
                </Button>
              </>
            )}
          </section>

          {/* Reschedule */}
          <section className="flex flex-col gap-3 rounded-md border border-line p-4">
            <Switch
              label={t("reschedule")}
              description={required === "reschedule" ? t("requiredSection") : t("rescheduleHint")}
              checked={value.reschedule.enabled || required === "reschedule"}
              disabled={required === "reschedule"}
              onCheckedChange={(on) => onChange({ ...value, reschedule: { ...value.reschedule, enabled: on } })}
            />
            {(value.reschedule.enabled || required === "reschedule") && (
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField
                  label={t("freeUntil")}
                  inputMode="numeric"
                  dir="ltr"
                  className="font-latin text-start"
                  value={value.reschedule.free_until_hours_before}
                  onChange={(e) => onChange({ ...value, reschedule: { ...value.reschedule, free_until_hours_before: e.target.value } })}
                  error={err("reschedule", "free_until_hours_before")}
                />
                <TextField
                  label={t("feeAfter")}
                  inputMode="decimal"
                  dir="ltr"
                  className="font-latin text-start"
                  suffix={t("currency")}
                  value={value.reschedule.fee_after}
                  onChange={(e) => onChange({ ...value, reschedule: { ...value.reschedule, fee_after: e.target.value } })}
                  error={err("reschedule", "fee_after")}
                />
                <TextField
                  label={t("maxPerBooking")}
                  inputMode="numeric"
                  dir="ltr"
                  className="font-latin text-start"
                  value={value.reschedule.max_per_booking}
                  onChange={(e) => onChange({ ...value, reschedule: { ...value.reschedule, max_per_booking: e.target.value } })}
                  error={err("reschedule", "max_per_booking")}
                />
                <Switch
                  className="sm:col-span-3"
                  label={t("requiresApproval")}
                  checked={value.reschedule.requires_approval}
                  onCheckedChange={(on) => onChange({ ...value, reschedule: { ...value.reschedule, requires_approval: on } })}
                />
              </div>
            )}
          </section>

          {/* Company cancellation (the refund rule) */}
          <section className="flex flex-col gap-3 rounded-md border border-line p-4">
            <Switch
              label={t("companyCancellation")}
              description={required === "company_cancellation" ? t("requiredSection") : t("companyCancellationHint")}
              checked={value.company_cancellation.enabled || required === "company_cancellation"}
              disabled={required === "company_cancellation"}
              onCheckedChange={(on) => onChange({ ...value, company_cancellation: { ...value.company_cancellation, enabled: on } })}
            />
            {(value.company_cancellation.enabled || required === "company_cancellation") && (
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label={t("refundPercent")}
                  inputMode="numeric"
                  dir="ltr"
                  className="font-latin text-start"
                  suffix="%"
                  value={value.company_cancellation.refund_percent}
                  onChange={(e) =>
                    onChange({ ...value, company_cancellation: { ...value.company_cancellation, refund_percent: e.target.value } })
                  }
                  error={err("company_cancellation", "refund_percent")}
                />
                <Select
                  label={t("compensation")}
                  value={value.company_cancellation.compensation}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      company_cancellation: {
                        ...value.company_cancellation,
                        compensation: COMPENSATIONS.find((c) => c === e.target.value) ?? "none",
                      },
                    })
                  }
                  options={COMPENSATIONS.map((c) => ({ value: c, label: text.compensation(c) }))}
                />
              </div>
            )}
          </section>

          {/* Exceptions */}
          <section className="flex flex-col gap-2 rounded-md border border-line p-4">
            <ChipsInput
              label={t("exceptions")}
              hint={t("exceptionsHint")}
              value={value.exceptions ?? []}
              onChange={(exceptions) => onChange({ ...value, exceptions })}
              valueDir="ltr"
              placeholder="weather_alert"
              error={err("exceptions") ?? (value.exceptions ?? []).map((_, i) => err("exceptions", i)).find(Boolean)}
            />
          </section>
        </>
      )}
    </div>
  );
}
