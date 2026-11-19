"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingBlock, Notice, StatusBadge, TabPanel, Tabs, TextArea, TextField, useToast, useUnsavedChanges } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { pickText } from "@/lib/admin/catalog/fields";
import { legalKeys } from "@/lib/admin/customers/keys";
import { deletePage, fetchPage, publishPage, updatePage, type PagePatch } from "@/lib/admin/legal/endpoints";
import { useLegalError } from "@/lib/admin/legal/errors";
import { checkPage, quotesFigures, type PageDraft, type PageErrors } from "@/lib/admin/legal/forms";
import { ACCEPTANCE_SLUGS, LIMITS, type ContentPage } from "@/lib/admin/legal/types";
import { renderLegalText } from "@/lib/legal/renderLegalText";
import { RequirePermission } from "../../../../_components/RequirePermission";
import { Ltr } from "../../../bookings/_components/BookingBits";

const TAB_ID = "legal-lang";

function draftOf(page: ContentPage): PageDraft {
  return { version_label: page.version_label, effective_date: page.effective_date, title: { ...page.title }, body: { ...page.body } };
}

/** Only what changed, so a save never overwrites a field the person did not touch. */
export function changedFields(page: ContentPage, draft: PageDraft): PagePatch {
  const patch: PagePatch = {};
  if (draft.version_label.trim() !== page.version_label) patch.version_label = draft.version_label.trim();
  if (draft.effective_date !== page.effective_date) patch.effective_date = draft.effective_date;
  if (draft.title.ar !== page.title.ar || draft.title.en !== page.title.en) patch.title = draft.title;
  if (draft.body.ar !== page.body.ar || draft.body.en !== page.body.en) patch.body = draft.body;
  return patch;
}

/**
 * A11 legal page editor (settings.manage): a draft's label, effective date and the Arabic and English title and text, with
 * a preview that renders the text exactly as the customer page does (one renderer). Save sends only what changed with the
 * page's version as If-Match. Publishing moves the version customers read (terms and privacy also ask every customer to
 * accept it again); the cancellation page may quote no percentage, and the editor says so before the API refuses it. A
 * published or superseded version is read-only.
 */
export function LegalPageEditorScreen({ id }: { id: string }) {
  const t = useTranslations("admin.legal.editor");
  return (
    <RequirePermission anyOf={["settings.manage"]}>
      <Link href="/admin/settings/pages" className="inline-flex w-fit items-center gap-1 text-sm font-medium">
        <ChevronRight aria-hidden className="size-4 ltr:rotate-180" />
        {t("back")}
      </Link>
      <Editor id={id} />
    </RequirePermission>
  );
}

function Editor({ id }: { id: string }) {
  const t = useTranslations("admin.legal.editor");
  const numeric = /^\d{1,10}$/.test(id) ? Number(id) : null;
  const page = useQuery({ queryKey: legalKeys.page(numeric ?? 0), queryFn: () => fetchPage(numeric as number), enabled: numeric !== null });
  const notFound = numeric === null || (page.error instanceof AdminApiError && page.error.status === 404);
  if (notFound) {
    return (
      <Card>
        <EmptyState title={t("notFound")} />
      </Card>
    );
  }
  if (page.isPending) return <LoadingBlock lines={10} className="rounded-lg bg-surface p-5 shadow-card" />;
  if (page.isError && !page.data) {
    return (
      <Card>
        <ErrorState error={page.error} onRetry={() => void page.refetch()} />
      </Card>
    );
  }
  // Keyed by the version, so a page read again after a save or a reload starts its form from the saved text.
  return <EditorBody key={`${page.data.id}-${page.data.version}`} page={page.data} />;
}

function EditorBody({ page }: { page: ContentPage }) {
  const t = useTranslations("admin.legal.editor");
  const legal = useTranslations("admin.legal");
  const locale = useLocale();
  const describe = useLegalError();
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const editable = page.status === "draft";
  const [draft, setDraft] = useState<PageDraft>(() => draftOf(page));
  const [lang, setLang] = useState<"ar" | "en">(locale === "en" ? "en" : "ar");
  const [errors, setErrors] = useState<PageErrors>({});
  const [stale, setStale] = useState(false);
  const [confirm, setConfirm] = useState<"publish" | "delete" | null>(null);
  const patch = changedFields(page, draft);
  const dirty = editable && Object.keys(patch).length > 0;
  useUnsavedChanges(dirty);
  const figures = quotesFigures(page.slug, draft.title, draft.body);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: legalKeys.all });

  const save = useMutation({
    mutationFn: () => {
      const checked = checkPage(draft);
      if (!checked.ok) throw new Invalid(checked.errors);
      return updatePage(page.id, patch, page.version);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(legalKeys.page(saved.id), saved);
      refresh();
      toast.success(t("saved"));
    },
    onError: (e) => {
      if (e instanceof Invalid) return setErrors(e.errors);
      if (e instanceof AdminApiError && e.code === "STALE_VERSION") setStale(true);
    },
  });
  const failed = save.isError && !(save.error instanceof Invalid) && !(save.error instanceof AdminApiError && save.error.code === "STALE_VERSION") ? save.error : null;

  const setTitle = (value: string) => setDraft((d) => ({ ...d, title: { ...d.title, [lang]: value } }));
  const setBody = (value: string) => setDraft((d) => ({ ...d, body: { ...d.body, [lang]: value } }));
  const langErrors = (field: "title" | "body") => errors[field]?.[lang] ?? null;

  return (
    <>
      <section aria-labelledby="legal-title" className="flex flex-col gap-3 rounded-lg bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 id="legal-title" className="text-[26px]/[34px] font-bold text-ink-900">
              {legal(`slugs.${page.slug}`)} · <Ltr>{page.version_label}</Ltr>
            </h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge tone={page.status === "published" ? "success" : page.status === "draft" ? "pending" : "neutral"}>{pickText(page.status_label, locale)}</StatusBadge>
            </div>
          </div>
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="text-danger-700" onClick={() => setConfirm("delete")}>
                {t("deleteDraft")}
              </Button>
              <Button variant="secondary" onClick={() => (setErrors({}), save.mutate())} loading={save.isPending} disabled={!dirty}>
                {t("save")}
              </Button>
              <Button onClick={() => setConfirm("publish")} disabled={dirty || figures} title={dirty ? t("saveFirst") : undefined}>
                {t("publish")}
              </Button>
            </div>
          )}
        </div>
        {!editable && <Notice tone="neutral">{t("readOnly")}</Notice>}
        {editable && dirty && <Notice tone="info">{t("saveFirst")}</Notice>}
        {figures && <Notice tone="warning">{t("figures")}</Notice>}
        {stale && (
          <Notice
            tone="warning"
            title={t("staleTitle")}
            action={
              <div>
                <Button size="sm" variant="secondary" onClick={() => (setStale(false), refresh())}>
                  {t("reload")}
                </Button>
              </div>
            }
          >
            {t("staleBody")}
          </Notice>
        )}
        {failed && <Notice tone="danger">{describe(failed)}</Notice>}
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card title={t("fields")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t("label")}
              hint={t("labelHint")}
              required
              dir="ltr"
              disabled={!editable}
              maxLength={LIMITS.versionLabel + 10}
              value={draft.version_label}
              onChange={(e) => setDraft((d) => ({ ...d, version_label: e.target.value }))}
              error={errors.version_label ? t(`errors.label.${errors.version_label}`, { max: LIMITS.versionLabel }) : undefined}
            />
            <TextField
              label={t("effective")}
              type="date"
              required
              disabled={!editable}
              value={draft.effective_date}
              onChange={(e) => setDraft((d) => ({ ...d, effective_date: e.target.value }))}
              error={errors.effective_date ? t(`errors.date.${errors.effective_date}`) : undefined}
            />
          </div>
          <Tabs
            id={TAB_ID}
            label={t("language")}
            items={[
              { value: "ar", label: t("arabic") },
              { value: "en", label: t("english") },
            ]}
            value={lang}
            onValueChange={(v) => setLang(v as "ar" | "en")}
          />
          <TabPanel id={TAB_ID} value={lang} className="flex flex-col gap-4 outline-none">
            <TextField
              key={`title-${lang}`}
              label={t("pageTitle")}
              required
              disabled={!editable}
              dir={lang === "ar" ? "rtl" : "ltr"}
              lang={lang}
              maxLength={LIMITS.title + 20}
              value={draft.title[lang]}
              onChange={(e) => setTitle(e.target.value)}
              error={langErrors("title") ? t(`errors.title.${langErrors("title")}`, { max: LIMITS.title }) : undefined}
            />
            <TextArea
              key={`body-${lang}`}
              label={t("body")}
              hint={t("bodyHint")}
              required
              disabled={!editable}
              rows={18}
              dir={lang === "ar" ? "rtl" : "ltr"}
              lang={lang}
              value={draft.body[lang]}
              onChange={(e) => setBody(e.target.value)}
              error={langErrors("body") ? t(`errors.body.${langErrors("body")}`, { max: LIMITS.body }) : undefined}
            />
            <p className="text-xs text-ink-600">{t("count", { count: Array.from(draft.body[lang]).length, max: LIMITS.body })}</p>
          </TabPanel>
        </Card>
        <Card title={t("preview")}>
          <p className="text-xs text-ink-600">{t("previewHint")}</p>
          <article lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} className={lang === "ar" ? "font-arabic" : "font-latin"} aria-label={t("preview")}>
            <h2 className="text-[22px]/[30px] font-bold text-ink-900">{draft.title[lang] || t("untitled")}</h2>
            <div className="mt-2">{renderLegalText(draft.body[lang])}</div>
          </article>
        </Card>
      </div>

      {confirm === "publish" && <PublishDialog page={page} onClose={() => setConfirm(null)} />}
      {confirm === "delete" && (
        <DeleteDialog
          page={page}
          onClose={() => setConfirm(null)}
          onDeleted={() => {
            refresh();
            toast.success(t("deleted"));
            router.push("/admin/settings/pages");
          }}
        />
      )}
    </>
  );
}

class Invalid extends Error {
  constructor(readonly errors: PageErrors) {
    super("invalid");
  }
}

/** Publishes the saved draft with a reason (kept in the audit): it becomes the version customers read. */
function PublishDialog({ page, onClose }: { page: ContentPage; onClose: () => void }) {
  const t = useTranslations("admin.legal.publish");
  const legal = useTranslations("admin.legal");
  const describe = useLegalError();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [short, setShort] = useState(false);
  const asks = ACCEPTANCE_SLUGS.includes(page.slug);

  const run = useMutation({
    mutationFn: () => {
      const n = Array.from(reason.trim()).length;
      if (n < 3 || n > LIMITS.reason) throw new ShortReason();
      return publishPage(page.id, reason, page.version);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(legalKeys.page(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: legalKeys.all });
      toast.success(t("done", { page: legal(`slugs.${page.slug}`), version: saved.version_label }));
      onClose();
    },
    onError: (e) => {
      if (e instanceof ShortReason) setShort(true);
    },
  });
  const shown = run.isError && !(run.error instanceof ShortReason) ? run.error : null;

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && !run.isPending && onClose()}
      title={t("title", { page: legal(`slugs.${page.slug}`), version: page.version_label })}
      description={t("description")}
      confirmLabel={t("confirm")}
      pending={run.isPending}
      onConfirm={() => (setShort(false), run.mutate())}
    >
      <div className="flex flex-col gap-4">
        {asks && (
          <Notice tone="warning" title={t("acceptTitle")}>
            {t("acceptBody")}
          </Notice>
        )}
        <TextArea label={t("reason")} hint={t("reasonHint")} required rows={3} maxLength={LIMITS.reason + 100} value={reason} onChange={(e) => setReason(e.target.value)} error={short ? t("reasonError", { min: 3, max: LIMITS.reason }) : undefined} />
        {shown && <Notice tone="danger">{describe(shown)}</Notice>}
      </div>
    </ConfirmDialog>
  );
}

class ShortReason extends Error {}

function DeleteDialog({ page, onClose, onDeleted }: { page: ContentPage; onClose: () => void; onDeleted: () => void }) {
  const t = useTranslations("admin.legal.delete");
  const describe = useLegalError();
  const run = useMutation({ mutationFn: () => deletePage(page.id, page.version), onSuccess: onDeleted });
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && !run.isPending && onClose()}
      title={t("title", { version: page.version_label })}
      description={t("description")}
      confirmLabel={t("confirm")}
      tone="danger"
      pending={run.isPending}
      onConfirm={() => run.mutate()}
    >
      {run.isError && <Notice tone="danger">{describe(run.error)}</Notice>}
    </ConfirmDialog>
  );
}
