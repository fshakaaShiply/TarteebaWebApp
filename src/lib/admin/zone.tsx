"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/*
 * The top bar's zone filter (spec §17: "top bar with date, zone filter …"), shared by the pages that look at one zone
 * or all of them (A02 overview, A03 bookings, the capacity view). null = all zones. Remembered per browser as a
 * convenience (localStorage, may be unavailable: then it starts on all zones).
 */

const STORAGE_KEY = "tarteeba.admin.zone";

type ZoneFilter = { zoneId: number | null; setZoneId: (zoneId: number | null) => void };

const ZoneContext = createContext<ZoneFilter | null>(null);

function readStored(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const id = raw === null ? NaN : Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

function store(zoneId: number | null) {
  try {
    if (zoneId === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(zoneId));
  } catch {
    // Private window or blocked storage: the choice lasts for this page only.
  }
}

export function AdminZoneProvider({ children, initialZoneId }: { children: ReactNode; initialZoneId?: number | null }) {
  // The signed-in shell only renders in the browser (it waits for GET /admin/me), so storage can be read at once.
  const [zoneId, setState] = useState<number | null>(() =>
    initialZoneId !== undefined ? initialZoneId : typeof window === "undefined" ? null : readStored(),
  );
  const setZoneId = useCallback((next: number | null) => {
    setState(next);
    store(next);
  }, []);
  const value = useMemo(() => ({ zoneId, setZoneId }), [zoneId, setZoneId]);
  return <ZoneContext.Provider value={value}>{children}</ZoneContext.Provider>;
}

/** The shared zone filter; outside the admin shell (isolated tests) a page-local one. */
export function useAdminZone(): ZoneFilter {
  const shared = useContext(ZoneContext);
  const [local, setLocal] = useState<number | null>(null);
  return shared ?? { zoneId: local, setZoneId: setLocal };
}
