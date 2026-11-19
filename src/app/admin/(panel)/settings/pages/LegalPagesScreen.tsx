"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card, Dialog, EmptyState, ErrorState, LoadingBlock, Notice, PageHeader, StatusBadge, TextField } from "@/components/admin";
import { pickText } from "@/lib/admin/catalog/fields";
import { formatDateTime, formatIsoDate } from "@/lib/admin/format";
import { createPage, fetchPages } from "@/lib/admin/legal/endpoints";
import { useLegalError } from "@/lib/admin/legal/errors";
import { checkEffectiveDate, checkVersionLabel, type FieldError } from "@/lib/admin/legal/forms";
import { legalKeys } from "@/lib/admin/customers/keys";
import { LEGAL_SLUGS, LIMITS, type ContentPage, type ContentStatus, type LegalSlug } from "@/lib/admin/legal/types";
import { businessToday } from "@/lib/admin/format";
import { RequirePermission } from "../../../_components/RequirePermission";
import { Ltr } from "../../bookings/_components/BookingBits";

const statusTone: Record<ContentStatus, "success" | "pending" | "neutral"> = { published: "success", draft: "pending", superseded: "neutral" };

/**
 * A11 legal pages (spec §17 A11 "legal pages (versioned)"; settings.manage): for each of the terms, the privacy policy and
 * the cancellation policy, the version customers read now, the drafts being written and the history. A new version starts
 * from the published text; publishing it moves the version customers see (terms and privacy ask everyone to accept again).
 */
export function LegalPagesScreen() {
  const t = useTranslations("admin.legal");
  return (
    <RequirePermission anyOf={["settings.manage"]}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Pages />
    </RequirePermission>
  );
}

function Pages() {
  const t = useTranslations("admin.legal");
  const pages = useQuery({ queryKey: legalKeys.pages(), queryFn: () => fetchPages() });
  if (pages.isPending) return <LoadingBlock lines={8} className="rounded-lg bg-surface p-5 shadow-card" />;
  if (pages.isError) {
    return (
      <Card>
        <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />
      </Card>
    );
  }
  if (pages.data.length === 0) {
    return (
      <Card>
        <EmptyState title={t("empty")} />
      </Card>
    );
  }
  return (
    <>
      {LEGAL_SLUGS.map((slug) => (
        <SlugCard key={slug} slug={slug} pages={pages.data.filter((p) => p.slug === slug)} />
      ))}
    </>
  );
}

function SlugCard({ slug, pages }: { slug: LegalSlug; pages: ContentPage[] }) {
  const t = useTranslations("admin.legal");
  const locale = useLocale();
  const [creating, setCreating] = useState(false);
  const published = pages.find((p) => p.status === "published") ?? null;
  const drafts = pages.filter((p) => p.status === "draft");
  const history = pages.filter((p) => p.status === "superseded");
  const hasDraft = drafts.length > 0;
  return (
    <Card
      title={t(`slugs.${slug}`)}
      actions={
        <span className="flex flex-wrap items-center gap-2">
          <a href={`/policies/${slug}?lang=${locale === "en" ? "en" : "ar"}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium">
            {t("viewPublic")}
            <ExternalLink aria-hidden className="size-3.5" />
          </a>
          <Button size="sm" onClick={() => setCreating(true)} aria-label={t("newVersionLabel", { page: t(`slugs.${slug}`) })}>
            {t("newVersion")}
          </Button>
        </span>
      }
    >
      <p className="text-sm text-ink-600">{t(`hints.${slug}`)}</p>
      <section aria-label={t("published")} className="flex flex-col gap-2">
        <h3 className="text-sm font-bold text-ink-900">{t("published")}</h3>
        {published ? (
          <PageRow page={published} locale={locale} />
        ) : (
          <Notice tone="warning">{t("noPublished")}</Notice>
        )}
      </section>
      <section aria-label={t("drafts")} className="flex flex-col gap-2">
        <h3 className="text-sm font-bold text-ink-900">{t("drafts")}</h3>
        {hasDraft ? drafts.map((p) => <PageRow key={p.id} page={p} locale={locale} />) : <p className="text-sm text-ink-600">{t("noDrafts")}</p>}
      </section>
      {history.length > 0 && (
        <details className="flex flex-col gap-2">
          <summary className="cursor-pointer text-sm font-bold text-ink-900">{t("history", { count: history.length })}</summary>
          <div className="mt-2 flex flex-col gap-2">
            {history.map((p) => (
              <PageRow key={p.id} page={p} locale={locale} />
            ))}
          </div>
        </details>
      )}
      {creating && <NewVersionDialog slug={slug} published={published} onClose={() => setCreating(false)} />}
    </Card>
  );
}

function PageRow({ page, locale }: { page: ContentPage; locale: string }) {
  const t = useTranslations("admin.legal");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-ivory-50 px-3.5 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-ink-900">
            {t("version")} <Ltr>{page.version_label}</Ltr>
          </span>
          <StatusBadge tone={statusTone[page.status]}>{pickText(page.status_label, locale)}</StatusBadge>
        </span>
        <span className="truncate text-sm text-ink-600">{pickText(page.title, locale)}</span>
        <span className="text-xs text-ink-600">
          {t("effective", { date: formatIsoDate(page.effective_date, locale, "short") })}
          {page.published_at ? ` · ${t("publishedOn", { at: formatDateTime(page.published_at, locale), name: page.published_by?.name ?? "—" })}` : ""}
        </span>
      </div>
      <Link href={`/admin/settings/pages/${page.id}`} className="text-sm font-medium" aria-label={t(page.status === "draft" ? "editLabel" : "openLabel", { version: page.version_label })}>
        {t(page.status === "draft" ? "edit" : "open")}
      </Link>
    </div>
  );
}

/**
 * Starts a draft version of a page: the new label and the day it takes effect; it begins as a copy of the published text (or
 * of the newest version when nothing is published), so staff change what changed.
 */
function NewVersionDialog({ slug, published, onClose }: { slug: LegalSlug; published: ContentPage | null; onClose: () => void }) {
  const t = useTranslations("admin.legal.versionDialog");
  const legal = useTranslations("admin.legal");
  const describe = useLegalError();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pages = queryClient.getQueryData<ContentPage[]>(legalKeys.pages()) ?? [];
  const source = published ?? pages.filter((p) => p.slug === slug)[0] ?? null;
  const [label, setLabel] = useState("");
  const [date, setDate] = useState(businessToday());
  const [errors, setErrors] = useState<{ label?: FieldError; date?: FieldError }>({});

  const create = useMutation({
    mutationFn: () => {
      const e = { label: checkVersionLabel(label) ?? undefined, date: checkEffectiveDate(date) ?? undefined };
      if (e.label || e.date) throw new FieldProblem(e);
      return createPage({
        slug,
        version_label: label,
        effective_date: date,
        title: source ? { ar: source.title.ar, en: source.title.en } : { ar: "", en: "" },
        body: source ? { ar: source.body.ar, en: source.body.en } : { ar: "", en: "" },
      });
    },
    onSuccess: (page) => {
      void queryClient.invalidateQueries({ queryKey: legalKeys.all });
      router.push(`/admin/settings/pages/${page.id}`);
    },
    onError: (e) => {
      if (e instanceof FieldProblem) setErrors(e.errors);
    },
  });
  const shown = create.isError && !(create.error instanceof FieldProblem) ? create.error : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !create.isPending && onClose()}
      dismissible={!create.isPending}
      title={t("title", { page: legal(`slugs.${slug}`) })}
      description={source ? t("descriptionCopy", { version: source.version_label }) : t("descriptionEmpty")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            {t("cancel")}
          </Button>
          <Button onClick={() => (setErrors({}), create.mutate())} loading={create.isPending}>
            {t("create")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label={t("label")}
          hint={t("labelHint")}
          required
          dir="ltr"
          maxLength={LIMITS.versionLabel + 10}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          error={errors.label ? t(`errors.label.${errors.label}`, { max: LIMITS.versionLabel }) : undefined}
        />
        <TextField label={t("effective")} type="date" required value={date} onChange={(e) => setDate(e.target.value)} error={errors.date ? t(`errors.date.${errors.date}`) : undefined} />
        {shown && <Notice tone="danger">{describe(shown)}</Notice>}
      </div>
    </Dialog>
  );
}

class FieldProblem extends Error {
  constructor(readonly errors: { label?: FieldError; date?: FieldError }) {
    super("invalid");
  }
}
