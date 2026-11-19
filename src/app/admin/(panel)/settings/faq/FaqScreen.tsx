"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, IconButton, LoadingBlock, Notice, PageHeader, StatusBadge, Switch, TextArea, TextField, useToast } from "@/components/admin";
import { pickText } from "@/lib/admin/catalog/fields";
import { AdminApiError } from "@/lib/admin/client";
import { legalKeys } from "@/lib/admin/customers/keys";
import { createFaq, deleteFaq, fetchFaq, reorderFaq, updateFaq } from "@/lib/admin/legal/endpoints";
import { useLegalError } from "@/lib/admin/legal/errors";
import { checkFaq, moveId, type FaqErrors } from "@/lib/admin/legal/forms";
import { FAQ_PLACEHOLDERS, LIMITS, type FaqItem } from "@/lib/admin/legal/types";
import { RequirePermission } from "../../../_components/RequirePermission";
import { useSeenRecord } from "../../finance/_components/useSeenRecord";

/**
 * A11 FAQ (spec §17 A11; settings.manage): the questions customers read in the app's Help and on the web's Help page, in
 * the order shown. Each item is Arabic and English; an answer may hold the two placeholders the API fills in so a policy
 * value never goes stale in the text. Hidden items stay here for later. Moving an item sends the whole new order.
 */
export function FaqScreen() {
  return (
    <RequirePermission anyOf={["settings.manage"]}>
      <FaqList />
    </RequirePermission>
  );
}

type Dialog = { kind: "edit"; item: FaqItem | null } | { kind: "delete"; item: FaqItem };

function FaqList() {
  const t = useTranslations("admin.faq");
  const locale = useLocale();
  const describe = useLegalError();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const faq = useQuery({ queryKey: legalKeys.faq(), queryFn: fetchFaq });
  const items = faq.data ?? [];
  const refresh = () => void queryClient.invalidateQueries({ queryKey: legalKeys.faq() });

  const move = useMutation({
    mutationFn: (ids: number[]) => reorderFaq(ids),
    onSuccess: (list) => queryClient.setQueryData(legalKeys.faq(), list),
    onError: (e) => {
      toast.error(describe(e));
      refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: (item: FaqItem) => updateFaq(item.id, { is_active: !item.is_active }, item.version),
    onSuccess: refresh,
    onError: (e) => {
      toast.error(describe(e));
      refresh();
    },
  });
  const busy = move.isPending || toggle.isPending;
  const ids = items.map((i) => i.id);
  const atLimit = items.length >= LIMITS.faqItems;
  // A dialog follows the item as the list holds it now (null once the list no longer has it), and keeps its own copy.
  const liveOf = (item: FaqItem | null) => (item ? (items.find((i) => i.id === item.id) ?? null) : null);

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button onClick={() => setDialog({ kind: "edit", item: null })} icon={<Plus aria-hidden className="size-4" />} disabled={atLimit}>
            {t("add")}
          </Button>
        }
      />
      {atLimit && <Notice tone="warning">{t("limit", { max: LIMITS.faqItems })}</Notice>}
      <Card>
        {faq.isPending ? (
          <LoadingBlock lines={6} />
        ) : faq.isError && !faq.data ? (
          <ErrorState error={faq.error} onRetry={() => void faq.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState title={t("empty")} body={t("emptyBody")} />
        ) : (
          <ol className="flex flex-col divide-y divide-line" aria-label={t("listLabel")}>
            {items.map((item, index) => (
              <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-ink-900">{pickText(item.question, locale)}</span>
                    {!item.is_active && <StatusBadge tone="neutral">{t("hidden")}</StatusBadge>}
                  </span>
                  <span className="line-clamp-2 text-sm text-ink-600">{pickText(item.answer, locale)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Switch
                    checked={item.is_active}
                    onCheckedChange={() => toggle.mutate(item)}
                    label={t("activeFor", { n: index + 1 })}
                    stateLabel={t(item.is_active ? "shown" : "hidden")}
                    disabled={busy}
                    id={`faq-active-${item.id}`}
                  />
                  <IconButton label={t("moveUp", { n: index + 1 })} disabled={busy || index === 0} onClick={() => move.mutate(moveId(ids, index, -1))}>
                    <ArrowUp aria-hidden className="size-4" />
                  </IconButton>
                  <IconButton label={t("moveDown", { n: index + 1 })} disabled={busy || index === items.length - 1} onClick={() => move.mutate(moveId(ids, index, 1))}>
                    <ArrowDown aria-hidden className="size-4" />
                  </IconButton>
                  <IconButton label={t("edit", { n: index + 1 })} onClick={() => setDialog({ kind: "edit", item })}>
                    <Pencil aria-hidden className="size-4" />
                  </IconButton>
                  <IconButton label={t("delete", { n: index + 1 })} onClick={() => setDialog({ kind: "delete", item })}>
                    <Trash2 aria-hidden className="size-4" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
      {dialog?.kind === "edit" && <FaqDialog item={dialog.item} live={liveOf(dialog.item)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && <DeleteFaqDialog item={dialog.item} live={liveOf(dialog.item)} onClose={() => setDialog(null)} />}
    </>
  );
}

const isStale = (error: unknown) => error instanceof AdminApiError && error.code === "STALE_VERSION";

/**
 * What an FAQ dialog says after the API answered 409 STALE_VERSION: nothing was saved, the list is read again, and then
 * the question as it is saved now, for staff to check before they save or delete again with its new version.
 */
function FaqMovedNotice({ waiting, renewed, gone, current, renewedText }: { waiting: boolean; renewed: boolean; gone: boolean; current: FaqItem | null; renewedText: string }) {
  const t = useTranslations("admin.faq.moved");
  const locale = useLocale();
  if (gone) {
    return (
      <Notice tone="warning" title={t("title")} role="status">
        {t("gone")}
      </Notice>
    );
  }
  if (!waiting && !renewed) return null;
  return (
    <Notice tone="warning" title={t("title")} role="status">
      <span className="flex flex-col gap-1">
        <span>{waiting ? t("waiting") : renewedText}</span>
        {renewed && current && (
          <span className="flex flex-col gap-0.5 font-normal">
            <span className="font-bold">{pickText(current.question, locale)}</span>
            <span className="line-clamp-3">{pickText(current.answer, locale)}</span>
          </span>
        )}
      </span>
    </Notice>
  );
}

/**
 * Adds or edits an item. An edit sends the version of its copy of the item (useSeenRecord): the copy taken when the dialog
 * opened, renewed from the list only after the API said the item moved, so a save after a STALE_VERSION carries the new
 * version (and the person has seen the text now saved), and the typed text is kept throughout.
 */
function FaqDialog({ item, live, onClose }: { item: FaqItem | null; live: FaqItem | null; onClose: () => void }) {
  const t = useTranslations("admin.faq.dialog");
  const moved = useTranslations("admin.faq.moved");
  const describe = useLegalError();
  const toast = useToast();
  const queryClient = useQueryClient();
  const current = live ?? item;
  const seen = useSeenRecord({ version: current?.version ?? null, item: current });
  // An item the list no longer holds after a refused save was deleted meanwhile.
  const gone = item !== null && live === null;
  const [question, setQuestion] = useState(item ? { ...item.question } : { ar: "", en: "" });
  const [answer, setAnswer] = useState(item ? { ...item.answer } : { ar: "", en: "" });
  const [active, setActive] = useState(item?.is_active ?? true);
  const [errors, setErrors] = useState<FaqErrors>({});

  const save = useMutation({
    mutationFn: () => {
      const checked = checkFaq({ question, answer, is_active: active });
      if (!checked.ok) throw new Invalid(checked.errors);
      const editing = seen.record.item;
      return editing ? updateFaq(editing.id, { question, answer, is_active: active }, editing.version) : createFaq({ question, answer, is_active: active });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: legalKeys.faq() });
      toast.success(t(item ? "updated" : "created"));
      onClose();
    },
    onError: (e) => {
      if (e instanceof Invalid) return setErrors(e.errors);
      // The item changed meanwhile: the list is read again, and its new version replaces the copy (never resent as it was).
      if (isStale(e)) seen.moved();
      void queryClient.invalidateQueries({ queryKey: legalKeys.faq() });
    },
  });
  const shown = save.isError && !(save.error instanceof Invalid) && !isStale(save.error) ? save.error : null;
  const fieldError = (field: "question" | "answer", lang: "ar" | "en", max: number) => {
    const e = errors[field]?.[lang];
    return e ? t(`errors.${field}.${e}`, { max }) : undefined;
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !save.isPending && onClose()}
      dismissible={!save.isPending}
      size="lg"
      title={t(item ? "editTitle" : "addTitle")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t("cancel")}
          </Button>
          <Button onClick={() => (setErrors({}), seen.seen(), save.mutate())} loading={save.isPending} disabled={seen.waiting || gone}>
            {t("save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t("questionAr")} required dir="rtl" lang="ar" maxLength={LIMITS.question + 20} value={question.ar} onChange={(e) => setQuestion((q) => ({ ...q, ar: e.target.value }))} error={fieldError("question", "ar", LIMITS.question)} />
          <TextField label={t("questionEn")} required dir="ltr" lang="en" maxLength={LIMITS.question + 20} value={question.en} onChange={(e) => setQuestion((q) => ({ ...q, en: e.target.value }))} error={fieldError("question", "en", LIMITS.question)} />
          <TextArea label={t("answerAr")} required rows={5} dir="rtl" lang="ar" value={answer.ar} onChange={(e) => setAnswer((a) => ({ ...a, ar: e.target.value }))} error={fieldError("answer", "ar", LIMITS.answer)} />
          <TextArea label={t("answerEn")} required rows={5} dir="ltr" lang="en" value={answer.en} onChange={(e) => setAnswer((a) => ({ ...a, en: e.target.value }))} error={fieldError("answer", "en", LIMITS.answer)} />
        </div>
        <Notice tone="info" title={t("placeholdersTitle")}>
          <ul className="flex flex-col gap-0.5">
            {FAQ_PLACEHOLDERS.map((p) => (
              <li key={p}>
                <code dir="ltr" className="font-latin">{`{{${p}}}`}</code> {t(`placeholders.${p}`)}
              </li>
            ))}
          </ul>
        </Notice>
        {errors.placeholder && <Notice tone="danger">{t("errors.placeholder", { placeholder: `{{${errors.placeholder}}}` })}</Notice>}
        <Switch checked={active} onCheckedChange={setActive} label={t("active")} description={t("activeHint")} stateLabel={t(active ? "shown" : "hidden")} />
        <FaqMovedNotice waiting={seen.waiting} renewed={seen.renewed} gone={gone} current={seen.record.item} renewedText={moved("renewedEdit")} />
        {shown && <Notice tone="danger">{describe(shown)}</Notice>}
      </div>
    </Dialog>
  );
}

class Invalid extends Error {
  constructor(readonly errors: FaqErrors) {
    super("invalid");
  }
}

/**
 * Deletes an item with the version shown as If-Match (A4a §3), so a question someone rewrote meanwhile is not deleted
 * unseen: 409 STALE_VERSION reads the list again, shows the new text, and the next confirm carries its version.
 */
function DeleteFaqDialog({ item, live, onClose }: { item: FaqItem; live: FaqItem | null; onClose: () => void }) {
  const t = useTranslations("admin.faq.deleteDialog");
  const moved = useTranslations("admin.faq.moved");
  const locale = useLocale();
  const describe = useLegalError();
  const toast = useToast();
  const queryClient = useQueryClient();
  const seen = useSeenRecord(live ?? item);
  const gone = live === null;
  const run = useMutation({
    mutationFn: () => deleteFaq(seen.record.id, seen.record.version),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: legalKeys.faq() });
      toast.success(t("done"));
      onClose();
    },
    onError: (e) => {
      if (isStale(e)) seen.moved();
      void queryClient.invalidateQueries({ queryKey: legalKeys.faq() });
    },
  });
  const shown = run.isError && !isStale(run.error) ? run.error : null;
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && !run.isPending && onClose()}
      title={t("title")}
      description={t("description", { question: pickText(seen.record.question, locale) })}
      confirmLabel={t("confirm")}
      tone="danger"
      pending={run.isPending}
      // While the list is read again (or once the item is gone) a confirm would only send a refused version again.
      onConfirm={() => !seen.waiting && !gone && (seen.seen(), run.mutate())}
    >
      <FaqMovedNotice waiting={seen.waiting} renewed={seen.renewed} gone={gone} current={seen.record} renewedText={moved("renewedDelete")} />
      {shown && <Notice tone="danger">{describe(shown)}</Notice>}
    </ConfirmDialog>
  );
}
