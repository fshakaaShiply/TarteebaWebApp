"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { CalendarDay, SubscriptionDetail, SubscriptionOccurrence } from "@/lib/admin/subscriptions/types";
import { AssignWorkerDialog } from "./AssignWorkerDialog";
import { CancelSubscriptionDialog } from "./CancelSubscriptionDialog";
import { ConfirmSubscriptionDialog } from "./ConfirmSubscriptionDialog";
import { EditFollowingDialog } from "./EditFollowingDialog";
import { FreezeDialog } from "./FreezeDialog";
import { LiveOutDayDialog } from "./LiveOutDayDialog";
import { MoveVisitDialog } from "./MoveVisitDialog";
import { RenewDialog } from "./RenewDialog";
import { ResolveReviewDialog } from "./ResolveReviewDialog";
import { SkipDialog, UndoSkipDialog } from "./SkipDialogs";
import { AutoRenewOffDialog, DeclineReviewDialog, RejectSubscriptionDialog, UnfreezeDialog } from "./StatusDialogs";
import { CancelVisitByCompanyDialog, RescheduleRequestDialog, type RescheduleDecision } from "./VisitDecisionDialogs";

/** The dialogs the detail page opens; `visit` / `day` carry the row they were opened from. */
export type DialogRequest =
  | { kind: "confirm" }
  | { kind: "reject" }
  | { kind: "freeze" }
  | { kind: "unfreeze" }
  | { kind: "skip"; visit?: SubscriptionOccurrence }
  | { kind: "undoSkip"; visit?: SubscriptionOccurrence }
  | { kind: "renew" }
  | { kind: "autoRenewOff" }
  /** `party: "company"`: the company's cancellation while a review waits (the party is fixed). */
  | { kind: "cancel"; party?: "company" }
  | { kind: "resolveReview" }
  | { kind: "declineReview" }
  | { kind: "assign"; role: "primary" | "backup" }
  /** `initial`: the date and time a card was dropped on in A04 (the board hands the move over to A08). */
  | { kind: "move"; visit: SubscriptionOccurrence; initial?: { date: string; slotId: number | null } }
  | { kind: "following"; visit: SubscriptionOccurrence }
  | { kind: "companyMiss"; visit: SubscriptionOccurrence }
  | { kind: "decide"; request: RescheduleDecision }
  | { kind: "day"; day: CalendarDay; scope: "this" | "following" };

/**
 * One open dialog at a time. It works on the subscription as it was when it opened (its version is the If-Match); a
 * newer version loaded meanwhile only sets `changed`, which the dialog states. A 409 STALE_VERSION closes it and
 * `onStale` asks the page to reload.
 */
export function useSubscriptionDialogs(subscription: SubscriptionDetail, onStale: () => void): { open: (request: DialogRequest) => void; element: ReactNode } {
  const [state, setState] = useState<{ request: DialogRequest; subscription: SubscriptionDetail } | null>(null);
  const open = useCallback((request: DialogRequest) => setState({ request, subscription }), [subscription]);
  if (!state) return { open, element: null };

  const props = {
    subscription: state.subscription,
    onClose: () => setState(null),
    onStale,
    changed: state.subscription.version !== subscription.version,
  };
  const r = state.request;
  let element: ReactNode = null;
  switch (r.kind) {
    case "confirm":
      element = <ConfirmSubscriptionDialog {...props} />;
      break;
    case "reject":
      element = <RejectSubscriptionDialog {...props} />;
      break;
    case "freeze":
      element = <FreezeDialog {...props} />;
      break;
    case "unfreeze":
      element = <UnfreezeDialog {...props} />;
      break;
    case "skip":
      element = <SkipDialog {...props} visit={r.visit} />;
      break;
    case "undoSkip":
      element = <UndoSkipDialog {...props} visit={r.visit} />;
      break;
    case "renew":
      element = <RenewDialog {...props} />;
      break;
    case "autoRenewOff":
      element = <AutoRenewOffDialog {...props} />;
      break;
    case "cancel":
      element = <CancelSubscriptionDialog {...props} companyOnly={r.party === "company"} />;
      break;
    case "resolveReview":
      element = <ResolveReviewDialog {...props} />;
      break;
    case "declineReview":
      element = <DeclineReviewDialog {...props} />;
      break;
    case "assign":
      element = <AssignWorkerDialog {...props} role={r.role} />;
      break;
    case "move":
      element = <MoveVisitDialog {...props} visit={r.visit} initial={r.initial} />;
      break;
    case "following":
      element = <EditFollowingDialog {...props} visit={r.visit} />;
      break;
    case "companyMiss":
      element = <CancelVisitByCompanyDialog {...props} visit={r.visit} />;
      break;
    case "decide":
      element = <RescheduleRequestDialog {...props} request={r.request} />;
      break;
    case "day":
      element = <LiveOutDayDialog {...props} date={r.day.date} type={r.day.type} scope={r.scope} />;
      break;
  }
  return { open, element };
}
