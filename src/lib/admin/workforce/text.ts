"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { formatAed } from "@/lib/money";
import { formatDateTime, formatIsoDate, formatMonth, isolate } from "../format";
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

/** The label of a value, or null for one this app has no words for (the caller then words the sentence without it). */
const labelOrNull = (t: ReturnType<typeof useTranslations>, key: string): string | null => (/^[a-z_]+$/.test(key) && t.has(key) ? t(key) : null);

export function useWorkforceText() {
  const locale = useLocale();
  const w = useTranslations("admin.workers.enums");
  const i = useTranslations("admin.incentives.enums");
  const d = useTranslations("admin.workers.documents");
  // A visit's status and a round's kind are the bookings' and the trip planner's own words.
  const visit = useTranslations("admin.bookings.enums.visit");
  const round = useTranslations("admin.trips.enums.kind");
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
      /** A visit status of the attendance evidence ("completed"), or null for one with no label. */
      visitStatus: (status: string) => labelOrNull(visit, status),
      /** A round kind of the attendance evidence ("dropoff"), or null for one with no label. */
      roundKind: (kind: string) => labelOrNull(round, kind),
      money: (fils: number) => formatAed(fils, locale, { fixed: true }),
      /**
       * An amount inside a sentence: isolated left to right, so the sign of a negative amount stays before its digits in
       * an Arabic sentence ("-50.00 د.إ", never "50.00-"). Table cells set dir="ltr" themselves and use `money`.
       */
      moneyText: (fils: number) => isolate(formatAed(fils, locale, { fixed: true }), "ltr"),
      hours: (minutes: number) => hoursText(minutes),
      date: (iso: string | null | undefined) => formatIsoDate(iso, locale, "short"),
      dateLong: (iso: string | null | undefined) => formatIsoDate(iso, locale, "long"),
      dateTime: (iso: string | null | undefined) => formatDateTime(iso, locale),
      time: (iso: string | null | undefined) => dubaiTime(iso),
      month: (period: string) => formatMonth(`${period}-01`, locale),
    }),
    [locale, w, i, d, visit, round],
  );
}

export type WorkforceText = ReturnType<typeof useWorkforceText>;
