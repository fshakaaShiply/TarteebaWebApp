"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { LoadingBlock, StatusBadge, useToast } from "@/components/admin";
import {
  ALERTS_PAGE_SIZE,
  DEFAULT_POLL_SECONDS,
  alertHref,
  badgeCount,
  markAllReadInState,
  markReadInState,
  nextAlertsState,
  type AlertsState,
} from "@/lib/admin/alerts";
import { fetchAlerts, markAlertRead, markAllAlertsRead } from "@/lib/admin/endpoints";
import { useAdminErrorMessage } from "@/lib/admin/errors";
import { formatDateTime } from "@/lib/admin/format";
import { adminKeys } from "@/lib/admin/keys";
import type { AdminAlert } from "@/lib/admin/types";

/**
 * The top bar's alerts bell (spec §12 admin alerts, §17; D-11): the signed-in member's alerts, polled every 20 seconds
 * (the API's poll_seconds) while the tab is visible, with the unread count on the bell. The list opens in a popover;
 * each alert can be marked read and opens its booking (or other built page). Urgent alerts are marked. New arrivals
 * are announced to screen readers in a polite live region.
 */
export function AlertsBell() {
  const t = useTranslations("admin.alerts");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const alerts = useQuery({
    queryKey: adminKeys.alerts(),
    queryFn: async (): Promise<AlertsState> => {
      // The first call loads the newest page; every poll after it asks only for what is new since the last answer.
      const previous = queryClient.getQueryData<AlertsState>(adminKeys.alerts());
      const page = await fetchAlerts(previous ? { since: previous.since } : { perPage: ALERTS_PAGE_SIZE });
      return nextAlertsState(previous, page);
    },
    refetchInterval: (query) => (query.state.data?.pollSeconds ?? DEFAULT_POLL_SECONDS) * 1000,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
  });
  const unread = alerts.data?.unreadCount ?? 0;
  const arrived = alerts.data?.arrived;
  const announcement =
    !arrived || arrived.count === 0
      ? null
      : arrived.urgent === 0
        ? t("announceNew", { count: arrived.count })
        : arrived.urgent === arrived.count
          ? t("announceUrgent", { count: arrived.count })
          : t("announceMixed", { count: arrived.count, urgent: arrived.urgent });

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    panelRef.current?.focus();
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      {/* Alerts a poll brings are announced politely (the badge and the button's name change silently). A new node per
          poll that brought some, so the same words are read again. */}
      <p role="status" className="sr-only">
        {announcement && arrived && <span key={arrived.seq}>{announcement}</span>}
      </p>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={unread > 0 ? t("openUnread", { count: unread }) : t("open")}
        onClick={() => setOpen((v) => !v)}
        className="touch-target relative inline-flex size-10 shrink-0 items-center justify-center rounded-md text-ink-900 hover:bg-neutral-100"
      >
        <Bell aria-hidden className="size-5" strokeWidth={1.75} />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 end-0 flex h-5 min-w-5 items-center justify-center rounded-pill bg-danger-700 px-1 font-latin text-[11px] font-bold text-white"
          >
            {badgeCount(unread)}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={t("title")}
          tabIndex={-1}
          className="absolute end-0 top-12 z-30 flex max-h-[70dvh] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card outline-none"
        >
          <AlertsPanel state={alerts.data} pending={alerts.isPending} error={alerts.isError ? alerts.error : null} onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function AlertsPanel({
  state,
  pending,
  error,
  onNavigate,
}: {
  state: AlertsState | undefined;
  pending: boolean;
  error: unknown;
  onNavigate: () => void;
}) {
  const t = useTranslations("admin.alerts");
  const queryClient = useQueryClient();
  const toast = useToast();
  const describe = useAdminErrorMessage();

  const readOne = useMutation({
    mutationFn: (alert: AdminAlert) => markAlertRead(alert.id),
    onSuccess: ({ alert, unreadCount }) =>
      queryClient.setQueryData<AlertsState>(adminKeys.alerts(), (s) => (s ? markReadInState(s, alert, unreadCount) : s)),
    onError: (e) => toast.error(describe(e)),
  });
  const readAll = useMutation({
    mutationFn: markAllAlertsRead,
    onSuccess: () => queryClient.setQueryData<AlertsState>(adminKeys.alerts(), (s) => (s ? markAllReadInState(s, new Date().toISOString()) : s)),
    onError: (e) => toast.error(describe(e)),
  });

  const items = state?.items ?? [];
  const unread = state?.unreadCount ?? 0;

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <p className="font-bold text-ink-900">{t("title")}</p>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => readAll.mutate()}
            disabled={readAll.isPending}
            className="touch-target rounded-sm px-2 py-1 text-sm font-bold text-petrol-700 hover:bg-petrol-50 disabled:opacity-60"
          >
            {t("markAllRead")}
          </button>
        )}
      </div>
      <div className="overflow-y-auto">
        {pending && !state ? (
          <LoadingBlock lines={3} className="p-4" />
        ) : error && !state ? (
          <p role="alert" className="p-4 text-sm text-danger-700">
            {t("loadError")}
          </p>
        ) : items.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-600">{t("empty")}</p>
        ) : (
          <ul aria-label={t("listLabel")}>
            {items.map((alert) => (
              <AlertItem
                key={alert.id}
                alert={alert}
                onRead={() => readOne.mutate(alert)}
                reading={readOne.isPending && readOne.variables?.id === alert.id}
                onNavigate={() => {
                  if (!alert.read) readOne.mutate(alert);
                  onNavigate();
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function AlertItem({ alert, onRead, reading, onNavigate }: { alert: AdminAlert; onRead: () => void; reading: boolean; onNavigate: () => void }) {
  const t = useTranslations("admin.alerts");
  const locale = useLocale();
  const href = alertHref(alert);
  return (
    <li className={clsx("flex gap-3 border-t border-line px-4 py-3 first:border-t-0", !alert.read && "bg-petrol-50/50")}>
      <span
        aria-hidden
        className={clsx("mt-1.5 size-2 shrink-0 rounded-pill", alert.read ? "bg-transparent" : alert.urgent ? "bg-danger-700" : "bg-petrol-700")}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {alert.urgent && <StatusBadge tone="danger">{t("urgent")}</StatusBadge>}
          {!alert.read && <span className="sr-only">{t("unread")}</span>}
          {/* The text is in the language the alert was raised in, which may not be the page's. */}
          <p dir="auto" className="text-sm font-bold text-ink-900">
            {href ? (
              <Link href={href} onClick={onNavigate} className="text-ink-900 underline-offset-4 hover:text-petrol-700 hover:underline">
                {alert.title}
              </Link>
            ) : (
              alert.title
            )}
          </p>
        </div>
        {alert.body && (
          <p dir="auto" className="text-sm/6 text-ink-600">
            {alert.body}
          </p>
        )}
        {alert.created_at && (
          <time dateTime={alert.created_at} className="text-xs text-ink-600">
            {formatDateTime(alert.created_at, locale)}
          </time>
        )}
      </div>
      {!alert.read && (
        <button
          type="button"
          onClick={onRead}
          disabled={reading}
          aria-label={t("markReadLabel", { title: alert.title })}
          className="touch-target h-fit shrink-0 rounded-sm px-2 py-1 text-xs font-bold text-petrol-700 hover:bg-petrol-50 disabled:opacity-60"
        >
          {t("markRead")}
        </button>
      )}
    </li>
  );
}
