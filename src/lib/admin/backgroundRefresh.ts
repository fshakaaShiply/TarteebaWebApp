"use client";

import { hashKey, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

/*
 * Timed refresh of an open admin page (A02 overview, A03 booking page). The spec gives no interval for these (§13.2,
 * §17 A02/A03; D-11 sets 20 s for the alerts bell only), so they are named here.
 */

/** A02 overview: GET /admin/dashboard/summary and /admin/dashboard/alerts. */
export const OVERVIEW_REFRESH_MS = 60_000;
/** A03 booking page: GET /admin/bookings/{id}. */
export const BOOKING_REFRESH_MS = 30_000;

/*
 * Reads a poll sets off. A poll that changes the cached data can turn on or re-run other queries of the page with nobody
 * at the screen (the booking page: a visit's candidates once the request waits for confirmation or its team changed,
 * the refunds once money was taken). Until the user next acts (a pointer press, a key, a click, coming back to the tab,
 * history navigation), such reads are background polls too: their query passes `{ background: isPollDriven(client) }`.
 * Kept per QueryClient, so a page (or a test) with its own client starts clean.
 */
let activity = 0;
const pollChanges = new WeakMap<QueryClient, number>();
let listening = false;

function listenForActivity() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  const acted = () => {
    activity += 1;
  };
  for (const type of ["pointerdown", "keydown", "click"]) document.addEventListener(type, acted, true);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") acted();
  });
  window.addEventListener("focus", acted);
  window.addEventListener("popstate", acted);
}

function markPollChange(client: QueryClient) {
  listenForActivity();
  pollChanges.set(client, activity);
}

/** Whether a background poll changed this client's data since the user last acted: a read now is passive too. */
export function isPollDriven(client: QueryClient): boolean {
  return pollChanges.get(client) === activity;
}

export type BackgroundRefreshOptions = {
  everyMs: number;
  /** Off while the page has nothing to refresh (an invalid date, an id that is not a number …). */
  enabled?: boolean;
};

/**
 * Re-reads one cached query every `everyMs` while the tab is visible. `poll` must be the query's own read sent as a
 * background poll (`{ background: true }`: X-Background-Poll: 1), so the API checks the idle timeout but does not count
 * the read as staff activity (spec §13.2). Loads the user starts (opening the page, a filter, Refresh, window focus)
 * stay the query's own fetches, without the header.
 *
 *   - the timer stops while the tab is hidden and starts again when it is shown;
 *   - only a query that has its data and is not loading is refreshed, and the answer is dropped when a load the user
 *     started came in meanwhile (that one is at least as new);
 *   - the answer replaces the cached data only: dialogs keep the snapshot they opened with (its version stays the
 *     If-Match), as with any other refetch; an answer that changed the data marks the reads it sets off as background
 *     polls too (isPollDriven above);
 *   - a failed poll leaves the page as it is: a 401 (SESSION_EXPIRED) already went to sign-in through the admin client
 *     (lib/admin/client.ts), anything else shows on the next load the user starts.
 */
export function useBackgroundRefresh<T>(queryKey: QueryKey, poll: () => Promise<T>, { everyMs, enabled = true }: BackgroundRefreshOptions): void {
  const queryClient = useQueryClient();
  const latest = useRef({ queryKey, poll });
  useEffect(() => {
    latest.current = { queryKey, poll };
  });
  const keyHash = hashKey(queryKey);

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    let timer: ReturnType<typeof setInterval> | null = null;
    let inFlight = false;

    const tick = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      const { queryKey: key, poll: read } = latest.current;
      const query = queryClient.getQueryCache().find({ queryKey: key, exact: true });
      if (!query || query.state.data === undefined || query.state.fetchStatus !== "idle") return;
      const updates = query.state.dataUpdateCount;
      inFlight = true;
      try {
        const data = await read();
        const now = queryClient.getQueryCache().find({ queryKey: key, exact: true });
        if (now && now.state.dataUpdateCount === updates && now.state.fetchStatus === "idle") {
          const before = now.state.data;
          queryClient.setQueryData(key, data);
          // Structural sharing keeps the same object when nothing changed.
          if (queryClient.getQueryData(key) !== before) markPollChange(queryClient);
        }
      } catch {
        // Left as it is (see above).
      } finally {
        inFlight = false;
      }
    };
    const start = () => {
      timer ??= setInterval(() => void tick(), everyMs);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? stop() : start());

    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // The key's hash stands for the key; `poll` is read from the ref at each tick.
  }, [queryClient, keyHash, everyMs, enabled]);
}
