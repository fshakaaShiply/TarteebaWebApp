"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
import type { z } from "zod";
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  FilterBar,
  LtrText,
  Notice,
  PageHeader,
  Select,
  Switch,
  useToast,
  type Column,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { createPolicy, fetchPolicies, updatePolicy, type PolicyPayload } from "@/lib/admin/endpoints";
import { applyFieldErrors } from "@/lib/admin/errors";
import { adminKeys } from "@/lib/admin/keys";
import { checkReason } from "@/lib/admin/catalog/fields";
import {
  POLICY_TYPES,
  defaultRulesDraft,
  parseRulesJson,
  policyFormSchema,
  rulesErrorPath,
  rulesFromDraft,
  rulesToDraft,
  type RulesDraft,
  type RulesJsonProblem,
} from "@/lib/admin/catalog/policyRules";
import type { Policy, PolicyType } from "@/lib/admin/types";
import { formatAed } from "@/lib/money";
import { RequirePermission } from "../../../_components/RequirePermission";
import {
  ActiveBadge,
  BilingualFields,
  CodeField,
  EditorShell,
  FormErrorNotice,
  ReasonField,
  StaleDialog,
  useCatalogInvalidate,
} from "../_components/CatalogFields";
import { useCatalogText, useFieldError } from "../_components/catalogText";
import { PolicyRulesEditor } from "./PolicyRulesEditor";

const PER_PAGE = 25;

/** A11 cancellation / reschedule / refund policies (spec §11.4; values are D-02 placeholders until approved). */
export function PoliciesScreen() {
  const t = useTranslations("admin.catalog.policies");
  const [editing, setEditing] = useState<Policy | "new" | null>(null);
  return (
    <RequirePermission anyOf={["catalog.manage"]}>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button onClick={() => setEditing("new")} icon={<Plus aria-hidden className="size-4" />}>
            {t("create")}
          </Button>
        }
      />
      <PoliciesTable onEdit={setEditing} />
      {editing && <PolicyEditor policy={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </RequirePermission>
  );
}

function PoliciesTable({ onEdit }: { onEdit: (policy: Policy) => void }) {
  const t = useTranslations("admin.catalog.policies");
  const text = useCatalogText();
  const locale = useLocale();
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: adminKeys.policyList({ page, perPage: PER_PAGE, type, active: status }),
    queryFn: () => fetchPolicies({ page, perPage: PER_PAGE, type, isActive: status === "" ? undefined : status === "active" }),
    placeholderData: keepPreviousData,
  });

  const summary = (p: Policy) => {
    const r = p.rules ?? {};
    const parts: string[] = [];
    if (r.cancellation) parts.push(t("summary.tiers", { count: r.cancellation.length }));
    if (r.reschedule) {
      parts.push(
        t("summary.reschedule", {
          hours: r.reschedule.free_until_hours_before,
          fee: formatAed(r.reschedule.fee_fils_after, locale),
        }),
      );
    }
    if (r.company_cancellation) parts.push(t("summary.refund", { percent: r.company_cancellation.refund_percent }));
    if (r.exceptions?.length) parts.push(t("summary.exceptions", { count: r.exceptions.length }));
    return parts.join(" · ");
  };

  const columns: Column<Policy>[] = [
    {
      id: "policy",
      header: t("columns.policy"),
      cell: (p) => (
        <div className="flex flex-col">
          <span className="font-bold text-ink-900">{text.name(p.name)}</span>
          <LtrText className="text-xs text-ink-600">{p.code}</LtrText>
        </div>
      ),
    },
    { id: "type", header: t("columns.type"), cell: (p) => text.policyType(p.type) },
    { id: "rules", header: t("columns.rules"), cell: (p) => <span className="text-sm">{summary(p)}</span> },
    { id: "version", header: t("columns.version"), cell: (p) => <span className="font-latin">v{p.version}</span> },
    { id: "status", header: t("columns.status"), cell: (p) => <ActiveBadge active={p.is_active} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (p) => (
        <Button variant="ghost" size="sm" onClick={() => onEdit(p)} icon={<Pencil aria-hidden className="size-4" />} aria-label={t("editLabel", { name: text.name(p.name) })}>
          {t("edit")}
        </Button>
      ),
    },
  ];

  const filtered = type !== "" || status !== "";

  return (
    <Card>
      <Notice tone="warning">{t("placeholderNote")}</Notice>
      <FilterBar
        canReset={filtered}
        onReset={() => {
          setType("");
          setStatus("");
          setPage(1);
        }}
      >
        <Select
          label={t("filters.type")}
          placeholder={t("filters.allTypes")}
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
          options={POLICY_TYPES.map((p) => ({ value: p, label: text.policyType(p) }))}
          containerClassName="min-w-[180px]"
        />
        <Select
          label={t("filters.status")}
          placeholder={t("filters.allStatuses")}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          options={[
            { value: "active", label: t("filters.active") },
            { value: "inactive", label: t("filters.inactive") },
          ]}
          containerClassName="min-w-[160px]"
        />
      </FilterBar>
      <DataTable
        caption={t("tableCaption")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(p) => p.id}
        loading={list.isPending}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={filtered ? t("noMatches") : t("empty")} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
      />
    </Card>
  );
}

type PolicyFormValues = z.input<ReturnType<typeof policyFormSchema>>;
type PolicyFormOutput = z.output<ReturnType<typeof policyFormSchema>>;

const FIELDS = ["code", "type", "name", "name.ar", "name.en", "is_active", "reason"] as const;

export function PolicyEditor({ policy, onClose }: { policy: Policy | null; onClose: () => void }) {
  const mode = policy ? "edit" : "create";
  const t = useTranslations("admin.catalog.policies");
  const text = useCatalogText();
  const fieldError = useFieldError();
  const toast = useToast();
  const invalidate = useCatalogInvalidate();
  const formId = useId();
  const [fieldsApplied, setFieldsApplied] = useState(false);
  const [stale, setStale] = useState(false);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonProblem, setJsonProblem] = useState<RulesJsonProblem | null>(null);

  // The required rules section depends on the type, so the schema is built from the current values.
  const resolver: Resolver<PolicyFormValues, unknown, PolicyFormOutput> = (values, context, options) =>
    zodResolver(policyFormSchema(mode, values.type))(values, context, options);

  const {
    register,
    control,
    handleSubmit,
    setError,
    clearErrors,
    setValue,
    formState: { errors },
  } = useForm<PolicyFormValues, unknown, PolicyFormOutput>({
    resolver,
    defaultValues: {
      code: policy?.code ?? "",
      type: policy?.type ?? "cancellation",
      name: { ar: policy?.name.ar ?? "", en: policy?.name.en ?? "" },
      rules: policy ? rulesToDraft(policy.rules) : defaultRulesDraft("cancellation"),
      is_active: policy?.is_active ?? false,
      reason: "",
    },
  });
  const type = useWatch({ control, name: "type" }) as PolicyType;

  // Rule errors on the form view's fields outside a submit. trigger("rules") cannot do this: the rules are one
  // Controller field, and react-hook-form drops errors nested inside a field without registered sub-fields.
  const showRuleIssues = (draft: RulesDraft) => {
    clearErrors("rules");
    for (const issue of rulesFromDraft(draft, type).issues) {
      setError(["rules", ...issue.path].join(".") as "rules", { type: "custom", message: issue.message });
    }
  };

  const save = useMutation({
    mutationFn: ({ payload, reason }: { payload: PolicyPayload; reason: string }) =>
      policy ? updatePolicy(policy.id, { ...payload, reason }, policy.version) : createPolicy({ ...payload, reason }),
    onSuccess: (saved) => {
      invalidate();
      toast.success(policy ? t("updated", { name: text.name(saved.name), version: saved.version }) : t("created", { name: text.name(saved.name) }));
      onClose();
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") {
        setStale(true);
        return;
      }
      let applied = applyFieldErrors(error, setError, FIELDS);
      if (error instanceof AdminApiError && error.code === "VALIDATION_FAILED") {
        for (const [field, messages] of Object.entries(error.fieldErrors)) {
          const path = rulesErrorPath(field);
          if (path && messages[0]) {
            setError(path as "rules", { type: "server", message: messages[0] });
            applied = true;
          }
        }
        if (applied) setJsonMode(false);
      }
      setFieldsApplied(applied);
    },
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    if (jsonMode) {
      // Saving from the JSON view sends exactly what it shows; text the form cannot hold is refused, not rewritten.
      const parsed = parseRulesJson(jsonText);
      if (!parsed.ok) {
        e.preventDefault();
        setJsonProblem(parsed.problem);
        return;
      }
      setJsonProblem(null);
      setValue("rules", parsed.draft);
    }
    void handleSubmit(
      ({ payload, reason }) => {
        const reasonError = checkReason(reason);
        if (reasonError) {
          setError("reason", { message: reasonError });
          return;
        }
        save.mutate({ payload: payload as PolicyPayload, reason: reason.trim() });
      },
      (invalid) => {
        // Rule errors are shown on the form view's fields.
        if (invalid.rules) setJsonMode(false);
      },
    )(e);
  };

  return (
    <>
      <EditorShell
        mode={mode}
        wide
        title={policy ? t("editTitle", { name: text.name(policy.name) }) : t("createTitle")}
        description={policy ? t("versionNote", { version: policy.version }) : t("editorBody")}
        formId={formId}
        pending={save.isPending}
        onClose={onClose}
      >
        <form id={formId} noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <CodeField registration={register("code")} disabled={mode === "edit"} error={fieldError(errors.code)} />
          {mode === "create" ? (
            <Select
              label={t("type")}
              options={POLICY_TYPES.map((p) => ({ value: p, label: text.policyType(p) }))}
              hint={t("typeHint")}
              error={fieldError(errors.type)}
              {...register("type", {
                onChange: (e: { target: { value: string } }) => {
                  const next = POLICY_TYPES.find((p) => p === e.target.value) ?? "cancellation";
                  setValue("rules", defaultRulesDraft(next));
                  setJsonMode(false);
                },
              })}
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-900">{t("type")}</span>
              <span className="flex h-11 items-center rounded-sm bg-neutral-100 px-3 text-[15px] text-ink-900">{text.policyType(type)}</span>
              <span className="text-xs text-ink-600">{t("typeFixed")}</span>
            </div>
          )}
          <div className="sm:col-span-2">
            <BilingualFields
              label={t("name")}
              required
              ar={register("name.ar")}
              en={register("name.en")}
              errorAr={fieldError(errors.name?.ar ?? errors.name)}
              errorEn={fieldError(errors.name?.en)}
            />
          </div>
          <div className="sm:col-span-2">
            <Controller
              control={control}
              name="rules"
              render={({ field }) => (
                <PolicyRulesEditor
                  type={type}
                  value={field.value}
                  onChange={(draft) => {
                    field.onChange(draft);
                    // Once rule errors are showing, re-check as the admin fixes them.
                    if (errors.rules) showRuleIssues(draft);
                  }}
                  errors={errors.rules}
                  jsonMode={jsonMode}
                  onJsonModeChange={setJsonMode}
                  jsonText={jsonText}
                  onJsonTextChange={(v) => {
                    setJsonText(v);
                    setJsonProblem(null);
                  }}
                  jsonProblem={jsonProblem}
                  onInvalidDraft={() => showRuleIssues(field.value)}
                />
              )}
            />
          </div>
          <div className="sm:col-span-2">
            <Controller
              control={control}
              name="is_active"
              render={({ field }) => (
                <Switch label={t("active")} description={t("activeHint")} checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>
          <div className="sm:col-span-2">
            <ReasonField registration={register("reason")} error={fieldError(errors.reason)} />
          </div>
          <div className="sm:col-span-2">
            <FormErrorNotice error={save.error} fieldsApplied={fieldsApplied} />
          </div>
        </form>
      </EditorShell>
      <StaleDialog
        open={stale}
        onClose={() => setStale(false)}
        onReload={() => {
          setStale(false);
          invalidate();
          onClose();
        }}
      />
    </>
  );
}
