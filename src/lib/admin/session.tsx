"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AdminApiError, setAdminAuthHandler } from "./client";
import { fetchMe, logout as logoutRequest } from "./endpoints";
import { adminKeys } from "./keys";
import { TWO_FACTOR_PATH, hasAnyPermission } from "./nav";
import type { StaffMe } from "./types";

/*
 * The signed-in admin (A01). Loads GET /admin/me once (React Query) and:
 *   - 401 from any admin call (UNAUTHENTICATED, or SESSION_EXPIRED after the idle timeout) → clear every cache and go
 *     to /admin/login?next=<current path>, with the "session ended" notice when a session existed;
 *   - 403 TWO_FACTOR_SETUP_REQUIRED, or me.two_factor_setup_required → the two-factor enrolment page (P1-10);
 *   - exposes `can()` for hiding what the user lacks. The API still checks every permission.
 */

export type AdminSession = {
  me: StaffMe;
  can: (permission: string) => boolean;
  canAny: (permissions: readonly string[]) => boolean;
  /** True until the user confirms TOTP; only the two-factor page and sign-out work. */
  setupRequired: boolean;
  logout: () => Promise<void>;
};

const SessionContext = createContext<AdminSession | null>(null);

export function loginUrl(next: string | null, reason?: "expired" | "signed_out"): string {
  const params = new URLSearchParams();
  if (next) params.set("next", next);
  if (reason) params.set("reason", reason);
  const query = params.toString();
  return query ? `/admin/login?${query}` : "/admin/login";
}

export type SessionGate =
  | { state: "loading" }
  | { state: "error"; error: unknown; retry: () => void }
  | { state: "redirecting" }
  | { state: "ready"; session: AdminSession };

/**
 * Loads the session and wires the auth redirects. The shell renders from the returned gate; pages only render when
 * the gate is "ready", so no unauthorized data is ever shown.
 */
export function useAdminSessionGate(): SessionGate {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const hadSession = useRef(false);
  const leavingRef = useRef(false);
  const [leaving, setLeaving] = useState(false);

  const meQuery = useQuery({
    queryKey: adminKeys.me(),
    queryFn: fetchMe,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const me = meQuery.data;

  useEffect(() => {
    if (me) hadSession.current = true;
  }, [me]);

  const leaveTo = useCallback(
    (url: string) => {
      if (leavingRef.current) return;
      leavingRef.current = true;
      setLeaving(true);
      queryClient.clear();
      router.replace(url);
    },
    [queryClient, router],
  );

  useEffect(
    () =>
      setAdminAuthHandler((event) => {
        if (event.type === "unauthenticated") {
          const expired = hadSession.current || event.code === "SESSION_EXPIRED";
          leaveTo(loginUrl(`${window.location.pathname}${window.location.search}`, expired ? "expired" : undefined));
        } else {
          void queryClient.invalidateQueries({ queryKey: adminKeys.me() });
          if (window.location.pathname !== TWO_FACTOR_PATH) router.replace(TWO_FACTOR_PATH);
        }
      }),
    [leaveTo, queryClient, router],
  );

  const setupRequired = me?.two_factor_setup_required === true;
  const mustEnrol = setupRequired && pathname !== TWO_FACTOR_PATH;

  useEffect(() => {
    if (mustEnrol) router.replace(TWO_FACTOR_PATH);
  }, [mustEnrol, router]);

  // Keeps the auth handler quiet once signing out has started (set from state: `logout` must not touch refs).
  useEffect(() => {
    if (leaving) leavingRef.current = true;
  }, [leaving]);

  const logout = useCallback(async () => {
    setLeaving(true);
    try {
      await logoutRequest();
    } catch {
      // Signed out here either way; the server session also ends on its own after the idle timeout.
    }
    queryClient.clear();
    router.replace(loginUrl(null, "signed_out"));
  }, [queryClient, router]);

  const session = useMemo<AdminSession | null>(() => {
    if (!me) return null;
    return {
      me,
      can: (permission) => me.permissions.includes(permission),
      canAny: (permissions) => hasAnyPermission(me.permissions, permissions),
      setupRequired,
      logout,
    };
  }, [me, setupRequired, logout]);

  if (leaving) return { state: "redirecting" };
  if (meQuery.isError) {
    const error = meQuery.error;
    // 401: the auth handler is already on its way to the login page.
    if (error instanceof AdminApiError && error.status === 401) return { state: "redirecting" };
    return { state: "error", error, retry: () => void meQuery.refetch() };
  }
  if (!session) return { state: "loading" };
  if (mustEnrol) return { state: "redirecting" };
  return { state: "ready", session };
}

export function AdminSessionProvider({ session, children }: { session: AdminSession; children: ReactNode }) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useAdminSession(): AdminSession {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useAdminSession must be used inside the admin panel layout");
  return ctx;
}
