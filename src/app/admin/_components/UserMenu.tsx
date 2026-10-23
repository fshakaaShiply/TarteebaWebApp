"use client";

import clsx from "clsx";
import { ChevronDown, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { LtrText } from "@/components/admin";
import { TWO_FACTOR_PATH } from "@/lib/admin/nav";
import { useAdminSession } from "@/lib/admin/session";
import { useRoleLabel } from "./roleLabel";

/** Top-bar user menu: name, roles, account security, sign out. Escape or a click outside closes it. */
export function UserMenu() {
  const t = useTranslations("admin.shell");
  const ui = useTranslations("admin.ui");
  const { me, logout } = useAdminSession();
  const roleLabel = useRoleLabel();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    // Move focus into the menu when it opens.
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? index + 1 : index - 1;
      items[(next + items.length) % items.length]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const initial = me.name.trim().charAt(0) || "?";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 items-center gap-2 rounded-md px-2 text-sm font-medium text-ink-900 hover:bg-neutral-100"
      >
        <span aria-hidden className="flex size-8 items-center justify-center rounded-pill bg-petrol-50 font-bold text-petrol-700">
          {initial}
        </span>
        {/* The name from xl: below it the top bar's search needs the room (the open menu shows the name). */}
        <span className="hidden max-w-40 truncate xl:inline">{me.name}</span>
        <span className="sr-only xl:hidden">{t("userMenu")}</span>
        <ChevronDown aria-hidden className={clsx("size-4 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={t("userMenu")}
          onKeyDown={onMenuKeyDown}
          className="absolute end-0 top-12 z-30 flex w-72 flex-col rounded-lg border border-line bg-surface p-2 shadow-card"
        >
          <div className="flex flex-col gap-0.5 px-3 py-2">
            <span className="font-bold text-ink-900">{me.name}</span>
            <LtrText className="truncate text-xs text-ink-600">{me.email}</LtrText>
            <span className="text-xs text-ink-600">
              {me.roles.length ? me.roles.map((r) => roleLabel(r)).join(ui("listSeparator")) : t("noRole")}
            </span>
          </div>
          <div className="my-1 border-t border-line" />
          <Link
            role="menuitem"
            href={TWO_FACTOR_PATH}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-sm px-3 py-2.5 text-sm font-medium text-ink-900 hover:bg-petrol-50 hover:text-ink-900"
          >
            <ShieldCheck aria-hidden className="size-4 text-petrol-700" strokeWidth={1.75} />
            {t("security")}
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={() => void logout()}
            className="flex items-center gap-2 rounded-sm px-3 py-2.5 text-start text-sm font-medium text-danger-700 hover:bg-danger-50"
          >
            <LogOut aria-hidden className="size-4 rtl:-scale-x-100" strokeWidth={1.75} />
            {t("signOut")}
          </button>
        </div>
      )}
    </div>
  );
}
