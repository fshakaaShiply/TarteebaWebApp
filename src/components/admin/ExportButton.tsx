"use client";

import clsx from "clsx";
import { ChevronDown, Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { EXPORT_REPORTS, useExport, type ExportFormat, type ExportReportKey } from "@/lib/admin/exports";
import { useAdminSession } from "@/lib/admin/session";
import { Button, type ButtonVariant } from "./Button";

type Props = {
  report: ExportReportKey;
  /** The filters of the list on screen (what the person sees is what is exported); built with exportFilters(). */
  filters?: Record<string, unknown>;
  /** Fewer formats than the report offers (the page's own choice). */
  formats?: readonly ExportFormat[];
  /** The button's words; "Export" by default. */
  label?: string;
  variant?: ButtonVariant;
  className?: string;
};

/**
 * Export menu (reports.export): Excel, CSV and, for the VAT summary, PDF. Hidden without the permission (the API checks it
 * again, and the permission to read the data itself: 403 FORBIDDEN). A choice starts the export and follows it to the
 * download (useExport: toasts for "Preparing your file…", "Ready" and the reason when it fails). The list opens under the
 * button, closes on Escape, on a click outside and after a choice, and returns focus to the button.
 */
export function ExportButton({ report, filters, formats, label, variant = "outline", className }: Props) {
  const t = useTranslations("admin.finance.exports");
  const { can } = useAdminSession();
  const { start, busy } = useExport();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const offered = EXPORT_REPORTS[report].filter((f) => !formats || formats.includes(f));

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (!can("reports.export") || offered.length === 0) return null;

  const choose = (format: ExportFormat) => {
    setOpen(false);
    trigger.current?.focus();
    void start({ report, format, filters });
  };

  return (
    <div ref={root} className={clsx("relative", className)}>
      <Button
        ref={trigger}
        variant={variant}
        onClick={() => setOpen((v) => !v)}
        loading={busy}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        icon={<Download aria-hidden className="size-4" />}
      >
        {label ?? t("button")}
        <ChevronDown aria-hidden className="size-4" />
      </Button>
      {open && (
        <div
          id={menuId}
          role="group"
          aria-label={t("formatsLabel")}
          className="absolute end-0 z-20 mt-1 flex min-w-44 flex-col gap-0.5 rounded-md border border-line bg-surface p-1 shadow-card"
        >
          {offered.map((format) => (
            <button
              key={format}
              type="button"
              onClick={() => choose(format)}
              className="touch-target flex h-10 items-center rounded-sm px-3 text-start text-sm font-medium text-ink-900 hover:bg-neutral-100"
            >
              {t(`formats.${format}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
