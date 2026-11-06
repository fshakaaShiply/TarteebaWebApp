import { withQuery } from "../dashboard";
import { isIsoDate } from "../format";
import { SUBSCRIPTIONS_PATH } from "../nav";

/*
 * A04 → A08: a subscription's visit dropped on another day or time on the schedule board is moved from its subscription
 * (P4-48; design §6.2: USE_RESCHEDULE names the subscription "so the board links to A08's move dialog"). The link names
 * the visit by its booking and the date it is served on now (A08 finds the occurrence among that day's visits, whoever
 * follows it: the booking id comes with the board's card and with the API's refusal alike) and carries the drop's date
 * and slot, which fill A08's "Edit this visit" dialog. Nothing is moved until staff confirm there.
 */

export type SeriesMoveHandoff = {
  /** The visit's booking id. */
  booking: number;
  /** The date the visit is served on now. */
  on: string;
  /** The date and slot it was dropped on. */
  date: string;
  slotId: number | null;
};

/** "/admin/subscriptions/31?date=2026-10-24&move=9&on=2026-10-25&slot=1". */
export function seriesMoveHref(subscriptionId: number, handoff: SeriesMoveHandoff): string {
  return withQuery(`${SUBSCRIPTIONS_PATH}/${subscriptionId}`, { move: handoff.booking, on: handoff.on, date: handoff.date, slot: handoff.slotId });
}

const ID = /^\d{1,10}$/;

/** The hand-off a link carries (the page's search parameters), or null when it carries none or a broken one. */
export function parseSeriesMove(query: Record<string, string | string[] | undefined>): SeriesMoveHandoff | null {
  const one = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const booking = one("move");
  const on = one("on");
  const date = one("date");
  const slot = one("slot");
  if (!booking || !ID.test(booking) || !isIsoDate(on) || !isIsoDate(date)) return null;
  return { booking: Number(booking), on, date, slotId: slot && ID.test(slot) ? Number(slot) : null };
}
