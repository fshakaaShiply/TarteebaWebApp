"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card, StarRating, StatusBadge } from "@/components/admin";
import { Ltr } from "../_components/BookingBits";
import { statusTone, useQualityText } from "@/lib/admin/quality/labels";
import { useAdminSession } from "@/lib/admin/session";
import type { BookingDetail } from "@/lib/admin/types";
import { OpenComplaintDialog } from "./OpenComplaintDialog";

/**
 * The booking's quality block (A03; the `quality` of GET /admin/bookings/{id}): the customer's rating and the cases on
 * this booking, each a link to A10 (the case list is the API's: null without complaints.manage), and "Open complaint"
 * to log a call or a message as a case (complaints.manage). Hidden when the API sends no block.
 */
export function QualityCard({ booking }: { booking: BookingDetail }) {
  const t = useTranslations("admin.quality.bookingBlock");
  const text = useQualityText();
  const { can } = useAdminSession();
  const [opening, setOpening] = useState(false);
  const quality = booking.quality;
  if (!quality) return null;
  const mayManage = can("complaints.manage");
  const cases = quality.cases ?? [];
  const rating = quality.rating;

  return (
    <Card title={t("title")} actions={mayManage ? <Button size="sm" variant="secondary" onClick={() => setOpening(true)}>{t("openComplaint")}</Button> : undefined}>
      <section aria-label={t("rating")} className="flex flex-col gap-1">
        <h3 className="text-sm font-bold text-ink-900">{t("rating")}</h3>
        {rating ? (
          <div className="flex flex-wrap items-center gap-2">
            <StarRating value={rating.overall} showValue />
            {rating.is_low && <StatusBadge tone="danger">{t("low")}</StatusBadge>}
            {mayManage && (
              <Link href={`/admin/quality/ratings?q=${encodeURIComponent(booking.reference)}`} className="text-sm font-bold">
                {t("openRating")}
              </Link>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-600">{t("notRated")}</p>
        )}
      </section>
      {quality.cases !== null && (
        <section aria-label={t("cases")} className="flex flex-col gap-1.5 border-t border-line pt-3">
          <h3 className="text-sm font-bold text-ink-900">{t("cases")}</h3>
          {cases.length === 0 ? (
            <p className="text-sm text-ink-600">{t("noCases")}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {cases.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={`/admin/quality/${c.id}`} className="font-bold">
                    <Ltr>{c.reference}</Ltr>
                  </Link>
                  <span className="text-ink-600">{text.type(c.type)}</span>
                  <StatusBadge tone={statusTone[c.status]}>{text.status(c.status, c.status_label)}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {opening && <OpenComplaintDialog booking={booking} onClose={() => setOpening(false)} />}
    </Card>
  );
}
