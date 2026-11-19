"use client";

import { useTranslations } from "next-intl";
import { Notice } from "@/components/admin";

type Props = {
  kind: "payment" | "refund";
  /** useSeenRecord: the API said the record moved and its new state has not been read yet. */
  waiting: boolean;
  /** useSeenRecord: the record was read again after it moved. */
  renewed: boolean;
  /** The action still applies to the record as read again. */
  applies: boolean;
  /** The page can't read the record again (the list no longer holds it, or its read failed). */
  unavailable?: boolean;
  /** The dialog shows the record's facts (the refund dialogs); the clear-flag dialog has only its note. */
  facts?: boolean;
};

/**
 * What a dialog says after the API answered that its record moved (a 409 STALE_VERSION, NOT_FLAGGED and the like):
 * nothing was saved; then either the new facts to check before confirming again, or that the action no longer applies.
 * A status region, so a screen reader hears it without losing its place.
 */
export function RecordMovedNotice({ kind, waiting, renewed, applies, unavailable = false, facts = true }: Props) {
  const t = useTranslations("admin.finance.moved");
  if (!waiting && !renewed) return null;
  const body = waiting
    ? unavailable
      ? t("unavailable")
      : t("waiting", { kind })
    : !applies
      ? t("noLonger", { kind })
      : facts
        ? t("renewed", { kind })
        : t("renewedNoFacts", { kind });
  return (
    <Notice tone={renewed && !applies ? "info" : "warning"} title={t("title", { kind })} role="status">
      {body}
    </Notice>
  );
}
