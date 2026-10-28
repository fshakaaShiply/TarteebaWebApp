"use client";

import clsx from "clsx";
import { ChevronDown, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useId, useState } from "react";
import { ADMIN_NAV, activeNavHref, filterNav, type NavLeaf, type NavModule } from "@/lib/admin/nav";
import { useAdminSession } from "@/lib/admin/session";

/*
 * Admin navigation (design AdminOverview.dc.html): petrol column at the start side (right in Arabic, left in
 * English), modules A02–A13 in spec order, then the account (A01 security) and sign-out at the bottom. One entry is
 * the current page (activeNavHref): the path and, for an entry that names them, the query parameters
 * (A09's cancellation reviews are /admin/bookings?cancel_review=1).
 */

const itemBase = "flex min-h-10 items-center gap-2 rounded-sm px-3 py-2 text-[15px] transition-colors";

function LeafLink({ item, nested, activeHref, onNavigate }: { item: NavLeaf; nested?: boolean; activeHref: string | null; onNavigate?: () => void }) {
  const t = useTranslations("admin.nav");
  const active = activeHref === item.href;

  if (!item.built) {
    return (
      <span
        aria-disabled="true"
        title={t("later")}
        className={clsx(itemBase, "cursor-not-allowed justify-between text-petrol-50/60", nested && "ps-6 text-sm")}
      >
        <span>{t(item.labelKey)}</span>
        <span className="rounded-pill bg-petrol-800 px-2 py-0.5 text-[11px] font-medium text-sage-300">{t("laterShort")}</span>
        <span className="sr-only">{t("later")}</span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={clsx(
        itemBase,
        nested && "ps-6 text-sm",
        active
          ? "bg-surface font-bold text-petrol-700 hover:text-petrol-700"
          : "font-medium text-petrol-50 hover:bg-petrol-800 hover:text-white",
      )}
    >
      {t(item.labelKey)}
    </Link>
  );
}

function Group({ item, activeHref, onNavigate }: { item: NavModule; activeHref: string | null; onNavigate?: () => void }) {
  const t = useTranslations("admin.nav");
  const id = useId();
  const containsActive = item.children!.some((child) => child.href === activeHref);
  // null = follow the route (open while one of its pages is shown) until the user toggles it.
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? containsActive;

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setOpen(!expanded)}
        className={clsx(
          itemBase,
          "justify-between text-start font-medium hover:bg-petrol-800",
          containsActive ? "text-white" : "text-petrol-50",
        )}
      >
        <span>{t(item.labelKey)}</span>
        <ChevronDown aria-hidden className={clsx("size-4 transition-transform", expanded && "rotate-180")} />
      </button>
      <div id={id} hidden={!expanded} className="flex flex-col gap-0.5">
        {item.children!.map((child) => (
          <LeafLink key={child.id} item={child} nested activeHref={activeHref} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

export function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  // The query string only refines which entry is current: while it can't be read (a prerender), the path decides.
  return (
    <Suspense fallback={<NavBody search="" onNavigate={onNavigate} />}>
      <NavWithSearch onNavigate={onNavigate} />
    </Suspense>
  );
}

function NavWithSearch({ onNavigate }: { onNavigate?: () => void }) {
  const search = useSearchParams().toString();
  return <NavBody search={search} onNavigate={onNavigate} />;
}

function NavBody({ search, onNavigate }: { search: string; onNavigate?: () => void }) {
  const t = useTranslations("admin.nav");
  const common = useTranslations("common");
  const pathname = usePathname();
  const { me, logout } = useAdminSession();
  const modules = filterNav(ADMIN_NAV, me.permissions);
  const activeHref = activeNavHref(modules, pathname, search);
  const access = modules.find((m) => m.code === "A01");
  const main = modules.filter((m) => m.code !== "A01");
  const accessActive = access !== undefined && activeHref === access.href;

  return (
    <div className="flex h-full flex-col gap-1 px-3 py-5">
      <div className="px-3 pb-4 text-2xl font-bold text-white">
        {common("brand")} <span className="font-latin text-[13px] font-medium text-sage-300">{t("brandSuffix")}</span>
      </div>
      <nav aria-label={t("label")} className="flex flex-col gap-0.5">
        {main.map((item) =>
          item.children ? (
            <Group key={item.id} item={item} activeHref={activeHref} onNavigate={onNavigate} />
          ) : (
            <LeafLink key={item.id} item={item} activeHref={activeHref} onNavigate={onNavigate} />
          ),
        )}
      </nav>
      <div className="mt-auto flex flex-col gap-0.5 border-t border-petrol-800 pt-3">
        {access && (
          <Link
            href={access.href}
            onClick={onNavigate}
            aria-current={accessActive ? "page" : undefined}
            className={clsx(
              itemBase,
              "text-sm",
              accessActive ? "bg-surface font-bold text-petrol-700 hover:text-petrol-700" : "font-medium text-sage-300 hover:bg-petrol-800 hover:text-white",
            )}
          >
            <ShieldCheck aria-hidden className="size-4" strokeWidth={1.75} />
            {t(access.labelKey)}
          </Link>
        )}
        <button
          type="button"
          onClick={() => void logout()}
          className={clsx(itemBase, "text-start text-sm font-medium text-sage-300 hover:bg-petrol-800 hover:text-white")}
        >
          <LogOut aria-hidden className="size-4 rtl:-scale-x-100" strokeWidth={1.75} />
          {t("signOut")}
        </button>
      </div>
    </div>
  );
}
