"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Menu, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ErrorState, Skeleton, ToastProvider, UnsavedChangesProvider } from "@/components/admin";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { formatLongDate } from "@/lib/admin/format";
import { adminKeys } from "@/lib/admin/keys";
import { AdminSessionProvider, useAdminSessionGate } from "@/lib/admin/session";
import { AdminZoneProvider } from "@/lib/admin/zone";
import { AlertsBell } from "./AlertsBell";
import { NavContent } from "./SideNav";
import { UserMenu } from "./UserMenu";
import { ZoneFilter } from "./ZoneFilter";

/*
 * Admin shell (design AdminOverview.dc.html; spec §17 layout): navigation column at the start side, top bar with
 * today's date (Asia/Dubai), the shared zone filter, the alerts bell (D-11 polling), language switch and user menu.
 * Below the lg breakpoint the navigation collapses into a drawer opened from the top bar. Pages render only once
 * GET /admin/me has loaded.
 */
export function AdminPanel({ children }: { children: ReactNode }) {
  const gate = useAdminSessionGate();
  const router = useRouter();

  if (gate.state === "error") {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <ErrorState error={gate.error} onRetry={gate.retry} />
      </main>
    );
  }
  if (gate.state !== "ready") return <ShellSkeleton />;

  const { session } = gate;
  return (
    <AdminSessionProvider session={session}>
      <ToastProvider>
        <UnsavedChangesProvider navigate={(href) => router.push(href)}>
          <AdminZoneProvider>
            <LocaleCacheReset />
            <div className="flex min-h-dvh">
              {!session.setupRequired && (
                <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 overflow-y-auto bg-petrol-700 lg:block">
                  <NavContent />
                </aside>
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <TopBar withNav={!session.setupRequired} />
                <main id="admin-main" className="flex min-w-0 flex-1 flex-col gap-5 p-4 md:p-6">
                  {children}
                </main>
              </div>
            </div>
          </AdminZoneProvider>
        </UnsavedChangesProvider>
      </ToastProvider>
    </AdminSessionProvider>
  );
}

/** The API localizes labels and messages (Accept-Language): refetch admin data after a language switch. */
function LocaleCacheReset() {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const previous = useRef(locale);
  useEffect(() => {
    if (previous.current === locale) return;
    previous.current = locale;
    void queryClient.invalidateQueries({ queryKey: adminKeys.all });
  }, [locale, queryClient]);
  return null;
}

function TodayLabel() {
  const locale = useLocale();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return (
    <time dateTime={now.toISOString()} className="hidden truncate text-sm text-ink-600 md:block">
      {formatLongDate(now, locale)}
    </time>
  );
}

function TopBar({ withNav }: { withNav: boolean }) {
  const t = useTranslations("admin.shell");
  const [navOpen, setNavOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-line bg-surface px-4 md:px-6">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-2 focus:z-30 focus:rounded-sm focus:bg-petrol-50 focus:px-3 focus:py-2 focus:text-sm"
      >
        {t("skipToContent")}
      </a>
      <div className="flex min-w-0 items-center gap-2">
        {withNav && (
          <RadixDialog.Root open={navOpen} onOpenChange={setNavOpen}>
            <RadixDialog.Trigger
              aria-label={t("openMenu")}
              className="touch-target inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-line text-ink-900 hover:bg-neutral-100 lg:hidden"
            >
              <Menu aria-hidden className="size-5" strokeWidth={1.75} />
            </RadixDialog.Trigger>
            <RadixDialog.Portal>
              <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink-900/40 lg:hidden" />
              <RadixDialog.Content
                aria-describedby={undefined}
                className="fixed inset-y-0 start-0 z-50 w-[280px] max-w-[85vw] overflow-y-auto bg-petrol-700 shadow-sheet lg:hidden"
              >
                <RadixDialog.Title className="sr-only">{t("menu")}</RadixDialog.Title>
                <RadixDialog.Close
                  aria-label={t("closeMenu")}
                  className="absolute end-2 top-3.5 inline-flex size-11 items-center justify-center rounded-md text-petrol-50 hover:bg-petrol-800"
                >
                  <X aria-hidden className="size-5" />
                </RadixDialog.Close>
                <NavContent onNavigate={() => setNavOpen(false)} />
              </RadixDialog.Content>
            </RadixDialog.Portal>
          </RadixDialog.Root>
        )}
        <TodayLabel />
      </div>
      <div className="flex items-center gap-1 sm:gap-2">
        {withNav && <ZoneFilter />}
        {withNav && <AlertsBell />}
        <LocaleSwitcher className="h-9 border border-line text-ink-900" />
        <UserMenu />
      </div>
    </header>
  );
}

function ShellSkeleton() {
  const t = useTranslations("admin.ui");
  return (
    <div className="flex min-h-dvh" role="status" aria-live="polite">
      <span className="sr-only">{t("loading")}</span>
      <div aria-hidden className="hidden w-[248px] shrink-0 bg-petrol-700 lg:block" />
      <div className="flex flex-1 flex-col">
        <div aria-hidden className="h-16 border-b border-line bg-surface" />
        <div className="flex flex-col gap-4 p-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
