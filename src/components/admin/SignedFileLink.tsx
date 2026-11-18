"use client";

import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { Download, ExternalLink, FileText } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useAdminErrorMessage } from "@/lib/admin/errors";
import { useNow } from "@/lib/admin/hooks";
import { formatDateTime } from "@/lib/admin/format";
import { Button } from "./Button";
import { Notice } from "./Layout";

/*
 * A private file (worker document, complaint attachment, export, invoice PDF) is never linked directly: the API answers
 * with a short-lived signed URL when asked. This asks on click, offers the link and moves focus to it, and asks again
 * once the link has expired. The URL lives only in this component's state: it is never written to storage, the URL bar,
 * the console or a log, and the link carries no referrer.
 */

/** What the API's "give me a link" endpoints answer inside `data`. */
export type SignedFile = {
  url: string;
  /** ISO time the link stops working; without it the link is trusted for a few minutes only. */
  expires_at?: string | null;
  file_name?: string | null;
};

/** A link without an expiry in its answer is asked for again after this long. */
const UNKNOWN_EXPIRY_MS = 4 * 60_000;

/**
 * A link is not offered in its last seconds (the API signs them for 15 minutes): the screen's clock only ticks every
 * 30 s, and the browser's may run a little ahead of the API's, so a click then would open a dead URL in a new tab.
 */
export const EXPIRY_MARGIN_MS = 30_000;

type Props = {
  /** Asks the API for a fresh link (a GET or POST that answers a SignedFile). */
  load: () => Promise<SignedFile>;
  /** The button's text, for example "View document". */
  label: string;
  /** What the file is, for the screen reader ("Residence visa of Maria"): the button then reads "<label>: <subject>". */
  subject?: string;
  /** Offer the browser's download instead of opening the file in a tab. */
  download?: boolean;
  variant?: "secondary" | "ghost" | "outline";
  className?: string;
};

export function SignedFileLink({ load, label, subject, download = false, variant = "secondary", className }: Props) {
  const t = useTranslations("admin.ui.signedFile");
  const locale = useLocale();
  const describe = useAdminErrorMessage();
  const link = useRef<HTMLAnchorElement>(null);
  const again = useRef<HTMLButtonElement>(null);
  const mutation = useMutation({ mutationFn: load });
  const now = useNow(30_000);
  /** The link a click found past its usable time (between two ticks of `now`): no longer offered. */
  const [lapsed, setLapsed] = useState<SignedFile | null>(null);
  const file = mutation.data;
  const expiresAt = file ? (file.expires_at ? Date.parse(file.expires_at) : mutation.submittedAt + UNKNOWN_EXPIRY_MS) : 0;
  const usableUntil = expiresAt - EXPIRY_MARGIN_MS;
  // A link at or near its expiry would fail at the storage: ask again instead of offering it.
  const ready = file && file !== lapsed && Number.isFinite(usableUntil) && usableUntil > now ? file : null;

  useEffect(() => {
    if (mutation.data) link.current?.focus();
  }, [mutation.data]);

  useEffect(() => {
    if (lapsed) again.current?.focus();
  }, [lapsed]);

  /** The screen's clock may be up to a tick behind: a click past the usable time asks for a new link instead. */
  const guard = (event: MouseEvent<HTMLAnchorElement>) => {
    if (Date.now() < usableUntil) return;
    event.preventDefault();
    setLapsed(file ?? null);
  };

  const visibleLabel = file ? t("again") : label;
  const accessibleName = subject ? t("named", { label: visibleLabel, subject }) : undefined;

  return (
    <div className={clsx("flex flex-col items-start gap-1.5", className)}>
      {ready ? (
        <a
          ref={link}
          href={ready.url}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          onClick={guard}
          onAuxClick={guard}
          {...(download ? { download: ready.file_name ?? "" } : {})}
          aria-label={subject ? t("openNamed", { subject }) : undefined}
          className="touch-target inline-flex h-10 items-center gap-2 rounded-md bg-petrol-700 px-4 text-sm font-bold text-white hover:bg-petrol-800 hover:text-white"
        >
          {download ? <Download aria-hidden className="size-4" /> : <ExternalLink aria-hidden className="size-4" />}
          {download ? t("download") : t("open")}
        </a>
      ) : (
        <Button
          ref={again}
          variant={variant}
          onClick={() => mutation.mutate()}
          loading={mutation.isPending}
          icon={<FileText aria-hidden className="size-4" />}
          aria-label={accessibleName}
        >
          {visibleLabel}
        </Button>
      )}
      {/* The time shown is when the link stops being offered, so it never disappears before the time it names. */}
      {ready?.expires_at && Number.isFinite(usableUntil) && (
        <p className="text-xs text-ink-600">{t("validUntil", { time: formatDateTime(new Date(usableUntil).toISOString(), locale) })}</p>
      )}
      {file && !ready && (
        <p role="status" className="text-xs text-ink-600">
          {t("expired")}
        </p>
      )}
      {mutation.isError && (
        <Notice tone="danger" className="w-full">
          {describe(mutation.error)}
        </Notice>
      )}
    </div>
  );
}
