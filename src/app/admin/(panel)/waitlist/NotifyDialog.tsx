"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmDialog, Notice, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { isolate } from "@/lib/admin/format";
import { adminKeys } from "@/lib/admin/keys";
import { useIdempotencyKeys } from "@/lib/admin/idempotency";
import { notifyWaitlistEntry } from "@/lib/admin/workforce/endpoints";
import { useWaitlistError } from "@/lib/admin/workforce/errors";
import { workforceKeys } from "@/lib/admin/workforce/keys";
import { notifyBody, type NotifyMode } from "@/lib/admin/workforce/waitlist";
import { useWorkforceText } from "@/lib/admin/workforce/text";
import type { WaitlistEntry } from "@/lib/admin/workforce/types";

/**
 * A staff offer to one waitlist request (waitlist §7.1, A6 §5.2): the customer is told by push, SMS and in-app message
 * that a place is free; nothing is held, the place goes to whoever completes payment first. "Notify again" over a live
 * offer says so and sends `force: true` only after this confirmation (P5-L32); a plain "Notify now" never forces. The
 * Idempotency-Key belongs to this open dialog and stays for a retry (a 429 or a lost answer); every 409 shows its own
 * words and re-reads the page, and the confirm then only closes, since the same offer would be refused again.
 */
export function NotifyDialog({ entry, mode, onClose }: { entry: WaitlistEntry; mode: NotifyMode; onClose: () => void }) {
  const t = useTranslations("admin.waitlist.notify");
  const toast = useToast();
  const describe = useWaitlistError();
  const wt = useWorkforceText();
  const queryClient = useQueryClient();
  const keys = useIdempotencyKeys();
  const [refused, setRefused] = useState(false);
  const name = entry.customer.name ? isolate(entry.customer.name) : t("theCustomer");
  const slot = `${wt.date(entry.date)}, ${wt.locale === "ar" ? entry.slot.name.ar : entry.slot.name.en}`;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: workforceKeys.waitlistAll() });
    void queryClient.invalidateQueries({ queryKey: adminKeys.capacity() });
  };
  const send = useMutation({
    mutationFn: () => {
      const body = notifyBody(mode);
      return notifyWaitlistEntry(entry.id, keys.keyFor(body), body.force);
    },
    onSuccess: () => {
      keys.settle();
      refresh();
      toast.success(t("sent", { name }));
      onClose();
    },
    onError: (error) => {
      keys.settle(error);
      refresh();
      setRefused(error instanceof AdminApiError && error.status === 409);
    },
  });

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={mode === "again" ? t("againTitle", { name }) : t("title", { name })}
      description={mode === "again" ? t("againBody", { name, slot }) : t("body", { name, slot })}
      confirmLabel={refused ? t("close") : mode === "again" ? t("againConfirm") : t("confirm")}
      pending={send.isPending}
      onConfirm={() => (refused ? onClose() : send.mutate())}
    >
      {mode === "again" && (
        <Notice tone="warning">{entry.offer.expires_at ? t("liveOffer", { time: wt.time(entry.offer.expires_at) }) : t("liveOfferPlain")}</Notice>
      )}
      <p className="text-sm text-ink-600">{t("nothingHeld")}</p>
      {send.error && <Notice tone="danger">{describe(send.error)}</Notice>}
    </ConfirmDialog>
  );
}
