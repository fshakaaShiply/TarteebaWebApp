"use client";

import clsx from "clsx";
import { FileText, Trash2, UploadCloud } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, type DragEvent } from "react";
import { fieldDescribedBy } from "./Field";

/*
 * The one file control of the admin (P5-X10): worker documents and photos, complaint attachments, settlement reports.
 * A real <input type="file"> (keyboard and screen readers work as for any file input) inside a drop area, with the
 * accepted types and the size limit written under the label, a type and size check before anything is sent, the chosen
 * files listed with a remove button, and a busy state while the caller's upload runs. The caller sends the files with
 * `adminUpload()` (src/lib/admin/client.ts); this component never uploads and never reads the file's content.
 */

/** Why a file was turned away before upload. */
export type FileRejection = "type" | "size" | "empty";

/** What an `accept` entry says: ".pdf", "application/pdf" or "image/*". */
function acceptedBy(entry: string, file: Pick<File, "name" | "type">): boolean {
  const wanted = entry.trim().toLowerCase();
  if (wanted.startsWith(".")) return file.name.toLowerCase().endsWith(wanted);
  const type = file.type.toLowerCase();
  if (wanted.endsWith("/*")) return type.startsWith(wanted.slice(0, -1));
  return type === wanted;
}

/**
 * The first reason the file cannot be uploaded, or null. An empty `accept` accepts every type. A file the browser gave no
 * type to is judged by its extension, so list extensions beside the MIME types when that matters.
 */
export function checkFile(file: Pick<File, "name" | "type" | "size">, rules: { accept: readonly string[]; maxBytes: number }): FileRejection | null {
  if (file.size === 0) return "empty";
  if (file.size > rules.maxBytes) return "size";
  if (rules.accept.length > 0 && !rules.accept.some((entry) => acceptedBy(entry, file))) return "type";
  return null;
}

const MIME_NAMES: Readonly<Record<string, string>> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "text/csv": "CSV",
  "text/plain": "TXT",
  "application/vnd.ms-excel": "XLS",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
};

/** "PDF, JPG, PNG" from a mix of MIME types and extensions, without repeats. */
export function acceptedTypeNames(accept: readonly string[]): string[] {
  const names = accept.map((entry) => {
    const lower = entry.trim().toLowerCase();
    if (lower.startsWith(".")) return lower.slice(1).toUpperCase();
    if (lower === "image/*") return "image";
    return MIME_NAMES[lower] ?? lower.split("/").pop()?.toUpperCase() ?? lower;
  });
  return [...new Set(names.map((n) => (n === "JPEG" ? "JPG" : n)))];
}

type Props = {
  label: string;
  /** MIME types and/or extensions, for example ["application/pdf", ".pdf", "image/jpeg", "image/png"]. */
  accept: readonly string[];
  /** The size limit of one file, in bytes. */
  maxBytes: number;
  /** The files chosen so far (controlled). */
  value: readonly File[];
  onChange: (files: File[]) => void;
  /** More than one file; `maxFiles` bounds the list (default 1 when not multiple). */
  multiple?: boolean;
  maxFiles?: number;
  hint?: string;
  /** The caller's own error (an upload the API refused), shown below like a field error. */
  error?: string | null;
  required?: boolean;
  disabled?: boolean;
  /** The caller's upload is running: the control is locked and says so. */
  busy?: boolean;
  /** 0 to 100 when the caller knows how far the upload is; omit for a plain busy state. */
  progress?: number;
  id?: string;
  className?: string;
  /** Called with each file turned away, e.g. to log nothing and only count; the message is shown by the field anyway. */
  onReject?: (file: File, reason: FileRejection) => void;
};

export function FileField({
  label,
  accept,
  maxBytes,
  value,
  onChange,
  multiple = false,
  maxFiles,
  hint,
  error,
  required,
  disabled,
  busy,
  progress,
  id,
  className,
  onReject,
}: Props) {
  const t = useTranslations("admin.ui.fileField");
  const autoId = useId();
  const fieldId = id ?? autoId;
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const limit = multiple ? (maxFiles ?? Number.POSITIVE_INFINITY) : 1;
  const locked = Boolean(disabled || busy);

  const size = (bytes: number) => formatSize(bytes, t as unknown as Translate);
  const types = acceptedTypeNames(accept).map((n) => (n === "image" ? t("anyImage") : n));
  const limits = t("limits", { types: types.length > 0 ? types.join(t("listSeparator")) : t("anyType"), size: size(maxBytes) });
  const shownError = error || rejected[0] || null;

  function take(incoming: File[]) {
    if (incoming.length === 0) return;
    const messages: string[] = [];
    const next = multiple ? [...value] : [];
    for (const file of incoming) {
      const reason = checkFile(file, { accept, maxBytes });
      if (reason) {
        onReject?.(file, reason);
        messages.push(
          reason === "size"
            ? t("tooLarge", { name: file.name, size: size(maxBytes) })
            : reason === "empty"
              ? t("empty", { name: file.name })
              : t("wrongType", { name: file.name, types: types.join(t("listSeparator")) }),
        );
      } else if (next.length >= limit) {
        messages.push(t("tooMany", { count: Number.isFinite(limit) ? limit : 0 }));
        break;
      } else {
        next.push(file);
      }
    }
    setRejected(messages);
    // A rejected pick leaves the files as they were (a single field keeps its current file).
    if (next.length > 0 || messages.length === 0) onChange(next);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (locked) return;
    take(Array.from(event.dataTransfer.files));
  }

  function remove(index: number) {
    setRejected([]);
    onChange(value.filter((_, i) => i !== index));
    input.current?.focus();
  }

  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <label htmlFor={fieldId} className="text-sm font-medium text-ink-900">
        {label}
        {required && (
          <span aria-hidden className="ms-0.5 text-danger-700">
            *
          </span>
        )}
      </label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!locked) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={clsx(
          "relative flex flex-col items-center gap-1.5 rounded-md border-[1.5px] border-dashed px-4 py-5 text-center transition-colors",
          "focus-within:ring-2 focus-within:ring-petrol-700/40",
          dragging ? "border-petrol-700 bg-petrol-50" : shownError ? "border-danger-700 bg-danger-50/40" : "border-line-strong bg-surface",
          locked && "opacity-70",
        )}
      >
        <UploadCloud aria-hidden className="size-6 text-petrol-700" />
        <p className="text-sm font-medium text-ink-900">{dragging ? t("dropNow") : multiple ? t("dropMany") : t("dropOne")}</p>
        <p className="text-xs text-ink-600">{limits}</p>
        {/* The real control covers the area, so a click, Enter, Space or a screen reader's "activate" all open the picker. */}
        <input
          ref={input}
          id={fieldId}
          type="file"
          multiple={multiple}
          accept={accept.join(",")}
          disabled={locked}
          aria-invalid={shownError ? true : undefined}
          aria-required={required || undefined}
          aria-describedby={fieldDescribedBy(fieldId, hint, shownError)}
          className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          onChange={(e) => {
            take(Array.from(e.target.files ?? []));
            // The same file can be chosen again after a remove.
            e.target.value = "";
          }}
        />
      </div>

      {value.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label={t("chosen")}>
          {value.map((file, index) => (
            <li key={`${file.name}-${file.size}-${index}`} className="flex items-center gap-2 rounded-sm border border-line bg-surface px-3 py-2 text-sm">
              <FileText aria-hidden className="size-4 shrink-0 text-ink-600" />
              <bdi className="min-w-0 flex-1 truncate font-medium text-ink-900">{file.name}</bdi>
              <span className="shrink-0 text-xs text-ink-600">{size(file.size)}</span>
              <button
                type="button"
                disabled={locked}
                aria-label={t("remove", { name: file.name })}
                title={t("remove", { name: file.name })}
                onClick={() => remove(index)}
                className="touch-target inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-600 hover:bg-neutral-100 disabled:opacity-50"
              >
                <Trash2 aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {busy && (
        <div role="status" className="flex flex-col gap-1 text-xs text-ink-600">
          <span>{typeof progress === "number" ? t("uploadingPercent", { percent: Math.round(progress) }) : t("uploading")}</span>
          {typeof progress === "number" && (
            <div
              role="progressbar"
              aria-label={t("uploading")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
              className="h-1.5 overflow-hidden rounded-pill bg-neutral-100"
            >
              <div className="h-full bg-petrol-700" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
            </div>
          )}
        </div>
      )}

      {hint && !shownError && (
        <p id={`${fieldId}-hint`} className="text-xs text-ink-600">
          {hint}
        </p>
      )}
      {shownError && (
        <p id={`${fieldId}-error`} role="alert" className="text-xs font-medium text-danger-700">
          {shownError}
        </p>
      )}
    </div>
  );
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** "10 MB", "850 KB": the size limit and each chosen file's size. */
function formatSize(bytes: number, t: Translate): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return t("sizeMb", { value: Number.isInteger(mb) ? String(mb) : mb.toFixed(1) });
  }
  return t("sizeKb", { value: Math.max(1, Math.round(bytes / 1024)) });
}
