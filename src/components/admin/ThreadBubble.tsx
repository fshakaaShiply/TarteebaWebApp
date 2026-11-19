"use client";

import clsx from "clsx";
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

/**
 * One message of a case thread (A10). The customer's words sit at the start in a plain bubble, the team's public
 * replies at the end in petrol, a resolution is marked as one, and an internal note is dashed with a lock and says in
 * words that the customer never sees it (never by colour alone). System lines (a booking rated, an SLA breach noted)
 * are small centred text. The body keeps its line breaks and is plain text, never markup.
 */
export function ThreadBubble({
  side,
  author,
  time,
  internal = false,
  resolution = false,
  children,
  files,
}: {
  side: "customer" | "team" | "system";
  author: string;
  /** Already formatted. */
  time: string;
  internal?: boolean;
  resolution?: boolean;
  children: ReactNode;
  /** The message's files (links), shown under the text. */
  files?: ReactNode;
}) {
  const t = useTranslations("admin.quality.thread");
  if (side === "system") {
    return (
      <li className="flex flex-col items-center gap-0.5 py-1 text-center text-xs text-ink-600">
        <span className="whitespace-pre-wrap">{children}</span>
        <span>{time}</span>
        {files}
      </li>
    );
  }
  return (
    <li className={clsx("flex", side === "team" ? "justify-end" : "justify-start")}>
      <article
        aria-label={t("messageBy", { author, time })}
        className={clsx(
          "flex max-w-[90%] flex-col gap-1.5 rounded-lg px-3.5 py-2.5 text-sm",
          internal
            ? "border-[1.5px] border-dashed border-warning-700/50 bg-apricot-100/60 text-ink-900"
            : side === "team"
              ? "bg-petrol-50 text-ink-900"
              : "bg-ivory-50 text-ink-900 ring-1 ring-line",
        )}
      >
        <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-600">
          <span className="font-bold text-ink-900">{author}</span>
          <span>{time}</span>
          {internal && (
            <span className="inline-flex items-center gap-1 rounded-sm bg-apricot-100 px-1.5 py-0.5 font-medium text-warning-700">
              <Lock aria-hidden className="size-3" />
              {t("internal")}
            </span>
          )}
          {resolution && <span className="rounded-sm bg-sage-100 px-1.5 py-0.5 font-medium text-success-700">{t("resolution")}</span>}
        </header>
        <p className="whitespace-pre-wrap break-words">{children}</p>
        {files}
      </article>
    </li>
  );
}
