"use client";

import { ExternalLink, FileText, Image as ImageIcon, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/admin";
import { EXPIRY_MARGIN_MS } from "@/components/admin/SignedFileLink";
import { useNow } from "@/lib/admin/hooks";
import type { Attachment } from "@/lib/admin/quality/types";

/*
 * A file of a case or a rating. Its link is signed by the API for 15 minutes and never kept: it lives only in the page's
 * data, opens in a new tab without a referrer, and once `url_expires_at` is close the link is not offered. A new one
 * comes from reading the case again (`onRefresh`), which the API answers with fresh links (A2 §8, client rule P5-Q95).
 */

function sizeText(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function AttachmentLink({ file, index, onRefresh, refreshing = false }: { file: Attachment; index: number; onRefresh: () => void; refreshing?: boolean }) {
  const t = useTranslations("admin.quality.files");
  const now = useNow(30_000);
  const pdf = file.mime === "application/pdf";
  const name = pdf ? t("pdf", { n: index }) : t("photo", { n: index });
  const Icon = pdf ? FileText : ImageIcon;
  const expires = file.url_expires_at ? Date.parse(file.url_expires_at) : NaN;
  const usable = Boolean(file.url) && Number.isFinite(expires) && expires - EXPIRY_MARGIN_MS > now;
  const meta = <span className="text-xs text-ink-600">{sizeText(file.size_bytes)}</span>;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {usable ? (
        <a
          href={file.url ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          className="touch-target inline-flex items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 py-1.5 text-sm font-medium text-petrol-700 hover:bg-petrol-50"
        >
          <Icon aria-hidden className="size-4" />
          {name}
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      ) : (
        <Button variant="outline" size="sm" onClick={onRefresh} loading={refreshing} icon={<RefreshCw aria-hidden className="size-4" />} aria-label={t("refreshNamed", { name })}>
          {name}
        </Button>
      )}
      {meta}
    </span>
  );
}

export function AttachmentList({ files, onRefresh, refreshing }: { files: readonly Attachment[]; onRefresh: () => void; refreshing?: boolean }) {
  const t = useTranslations("admin.quality.files");
  if (files.length === 0) return null;
  return (
    <ul aria-label={t("list")} className="flex flex-wrap gap-2">
      {files.map((file, i) => (
        <li key={file.id}>
          <AttachmentLink file={file} index={i + 1} onRefresh={onRefresh} refreshing={refreshing} />
        </li>
      ))}
    </ul>
  );
}
