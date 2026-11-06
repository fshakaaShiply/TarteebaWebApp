"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useRef, type ReactNode } from "react";
import { Button, Notice } from "@/components/admin";
import { useAdminSession } from "@/lib/admin/session";
import { visitActions } from "@/lib/admin/subscriptions/actions";
import { fetchSubscriptionVisits } from "@/lib/admin/subscriptions/endpoints";
import type { SeriesMoveHandoff } from "@/lib/admin/subscriptions/handoff";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import type { SubscriptionDetail } from "@/lib/admin/subscriptions/types";
import { useSubscriptionText } from "@/lib/admin/subscriptions/text";
import type { DialogRequest } from "./DialogHost";

/**
 * The A04 board's hand-off (lib/admin/subscriptions/handoff.ts): finds the dropped visit among the day's visits by its
 * booking and opens "Edit this visit" once, filled with the date and time it was dropped on, then takes the hand-off
 * out of the address (a reload shows the plain page). The lookup sits outside ["admin", "subscriptions"], so the
 * refresh after the move does not look again (the visit has moved). When the visit is not there, or cannot be moved
 * now (it started, or the user may not change it), a notice says so instead and the page is as usual.
 */
export function useMoveHandoff(subscription: SubscriptionDetail, handoff: SeriesMoveHandoff | null, open: (request: DialogRequest) => void): ReactNode {
  const t = useTranslations("admin.subscriptions.handoff");
  const text = useSubscriptionText();
  const { can } = useAdminSession();
  const lookup = useQuery({
    queryKey: subscriptionKeys.preview("handoff", subscription.id, handoff?.booking ?? 0, handoff?.on ?? ""),
    queryFn: async () => {
      const day = handoff as SeriesMoveHandoff;
      const page = await fetchSubscriptionVisits(subscription.id, { from: day.on, to: day.on, perPage: 100 });
      return page.data.find((o) => o.booking?.id === day.booking) ?? null;
    },
    enabled: handoff !== null,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const row = lookup.data ?? null;
  const movable = row !== null && visitActions(row, subscription, can).has("move");
  const opened = useRef(false);

  useEffect(() => {
    if (!handoff || !row || !movable || opened.current) return;
    opened.current = true;
    open({ kind: "move", visit: row, initial: { date: handoff.date, slotId: handoff.slotId } });
    window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [handoff, row, movable, open]);

  if (!handoff || lookup.isPending) return null;
  const date = text.dateShort(handoff.on);
  if (lookup.isError) {
    return (
      <Notice
        tone="warning"
        action={
          <Button variant="secondary" size="sm" className="self-start" onClick={() => void lookup.refetch()}>
            {t("retry")}
          </Button>
        }
      >
        {t("loadError", { date })}
      </Notice>
    );
  }
  if (!row) return <Notice tone="warning">{t("notFound", { date })}</Notice>;
  if (!movable) return <Notice tone="warning">{t("notMovable", { date })}</Notice>;
  return null;
}
