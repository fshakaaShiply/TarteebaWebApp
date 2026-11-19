"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { formatAed } from "@/lib/money";
import { formatDateTime, formatIsoDate, formatMonth } from "../format";
import { dubaiTime } from "./attendance";
import { hoursText } from "./incentives";
import type { AttendanceStatus, DocumentState, IncentiveGate, IncentiveStatus, ScoreKey, WorkerDocument } from "./types";

/*
 * Words and figures of the workforce screens: enum labels under admin.workers.enums and admin.incentives.enums (every
 * value has both languages, workforce-messages.test.ts), dates on the Dubai clock, money from fils with two decimals
 * like the other money screens, hours from minutes.
 */

const label = (t: ReturnType<typeof useTranslations>, group: string, value: string) => {
  const key = `${group}.${value}`;
  return t.has(key) ? t(key) : value;
};

export function useWorkforceText() {
  const locale = useLocale();
  const w = useTranslations("admin.workers.enums");
  const i = useTranslations("admin.incentives.enums");
  const d = useTranslations("admin.workers.documents");
  return useMemo(
    () => ({
      locale,
      documentType: (type: string) => label(w, "documentType", type),
      /** The title of an `other` document, else the type's name. */
      documentTitle: (doc: Pick<WorkerDocument, "type" | "title">) => (doc.type === "other" && doc.title ? doc.title : label(w, "documentType", doc.type)),
      /** "Valid" / "Expires in 21 days" / "Expires today" / "Expired" / "No expiry". */
      documentState: (state: DocumentState, daysLeft: number | null) =>
        state === "expiring" ? (daysLeft === 0 ? d("state.expiringToday") : d("state.expiring", { count: daysLeft ?? 0 })) : d(`state.${state}`),
      attendanceStatus: (status: AttendanceStatus | null) => (status === null ? w("attendanceStatus.none") : label(w, "attendanceStatus", status)),
      sheetStatus: (status: string) => label(w, "sheetStatus", status),
      source: (source: string | null) => (source === null ? "" : label(w, "source", source)),
      incentiveStatus: (status: IncentiveStatus | string) => label(i, "status", status),
      gate: (gate: IncentiveGate | string) => label(i, "gate", gate),
      score: (key: ScoreKey | string) => label(i, "score", key),
      releaseReason: (code: string) => label(w, "releaseReason", code),
      money: (fils: number) => formatAed(fils, locale, { fixed: true }),
      hours: (minutes: number) => hoursText(minutes),
      date: (iso: string | null | undefined) => formatIsoDate(iso, locale, "short"),
      dateLong: (iso: string | null | undefined) => formatIsoDate(iso, locale, "long"),
      dateTime: (iso: string | null | undefined) => formatDateTime(iso, locale),
      time: (iso: string | null | undefined) => dubaiTime(iso),
      month: (period: string) => formatMonth(`${period}-01`, locale),
    }),
    [locale, w, i, d],
  );
}

export type WorkforceText = ReturnType<typeof useWorkforceText>;
