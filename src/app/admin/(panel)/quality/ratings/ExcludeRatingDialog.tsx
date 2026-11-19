"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Dialog, Notice, TextArea, useToast } from "@/components/admin";
import { adminKeys } from "@/lib/admin/keys";
import { setRatingExcluded } from "@/lib/admin/quality/endpoints";
import { useQualityError } from "@/lib/admin/quality/errors";
import { NOTE_MAX, buildReason, type FormError } from "@/lib/admin/quality/forms";
import { qualityKeys } from "@/lib/admin/quality/keys";
import type { RatingDetail } from "@/lib/admin/quality/types";
import { useSeenRecord } from "../../finance/_components/useSeenRecord";
import { isStaleVersion } from "../_components/useCaseRefresh";

/**
 * Takes a rating out of every average (the cleaner's, the overview's, the customer's, incentives) or puts it back, with a
 * reason that is kept (audit `rating.exclusion_changed`, P5-Q34). The rating itself is never edited. The dialog acts on
 * its copy of the rating: the version it read is the If-Match, and a 409 STALE_VERSION shows the rating as read again
 * before the person confirms once more.
 */
export function ExcludeRatingDialog({ rating: live, onClose }: { rating: RatingDetail; onClose: () => void }) {
  const t = useTranslations("admin.quality.exclude");
  const describe = useQualityError();
  const toast = useToast();
  const queryClient = useQueryClient();
  const seen = useSeenRecord(live);
  const r = seen.record;
  const excluding = !r.excluded;
  const [reason, setReason] = useState("");
  const [error, setError] = useState<FormError | null>(null);

  const send = useMutation({
    mutationFn: (body: { reason: string }) => setRatingExcluded(r.id, excluding, body.reason, r.version),
    onSuccess: (answer) => {
      queryClient.setQueryData(qualityKeys.rating(answer.id), answer);
      void queryClient.invalidateQueries({ queryKey: qualityKeys.all });
      void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard() });
      toast.success(excluding ? t("doneExcluded") : t("doneIncluded"));
      onClose();
    },
    onError: (e) => {
      void queryClient.invalidateQueries({ queryKey: qualityKeys.rating(r.id) });
      if (isStaleVersion(e)) seen.moved();
    },
  });

  const submit = () => {
    const built = buildReason(reason);
    if (!built.ok) return setError(built.error);
    setError(null);
    send.reset();
    seen.seen();
    send.mutate(built.body);
  };
  const shown = send.isError && !isStaleVersion(send.error) ? send.error : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !send.isPending && onClose()}
      dismissible={!send.isPending}
      title={excluding ? t("titleExclude") : t("titleInclude")}
      description={excluding ? t("descriptionExclude") : t("descriptionInclude")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={send.isPending}>
            {t("cancel")}
          </Button>
          <Button variant={excluding ? "danger" : "primary"} onClick={submit} loading={send.isPending} disabled={seen.waiting}>
            {excluding ? t("confirmExclude") : t("confirmInclude")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {(seen.waiting || seen.renewed) && (
          <Notice tone="warning" title={t("movedTitle")} role="status">
            {seen.waiting ? t("movedWaiting") : t("movedRenewed")}
          </Notice>
        )}
        <TextArea label={t("reason")} hint={t("reasonHint")} required rows={3} maxLength={NOTE_MAX} value={reason} onChange={(e) => setReason(e.target.value)} error={error ? t(`errors.${error}`) : undefined} />
        {shown && <Notice tone="danger">{describe(shown)}</Notice>}
      </div>
    </Dialog>
  );
}
