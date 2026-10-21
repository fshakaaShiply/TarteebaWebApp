"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { ConfirmDialog } from "./Dialog";

/*
 * Unsaved-changes guard for full-page forms (e.g. the A11 service General tab). While a form registered with
 * useUnsavedChanges() is dirty:
 *   - a click on any in-app link asks first (styled confirmation; "Leave" then navigates);
 *   - reloading, closing the tab or following an external link triggers the browser's own warning (beforeunload).
 * The browser's Back button inside the app is not intercepted (the App Router has no hook for it).
 */

type Registry = { setDirty: (id: string, dirty: boolean) => void };

const UnsavedChangesContext = createContext<Registry | null>(null);

/** The in-app destination of a plain left click on a link, or null when the click should be left alone. */
export function guardedLinkTarget(event: MouseEvent, location: Location = window.location): string | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return null;
  const url = new URL(anchor.href, location.href);
  // Other sites unload the page, so beforeunload covers them; same-page anchors (#admin-main) lose nothing.
  if (url.origin !== location.origin) return null;
  if (url.pathname === location.pathname && url.search === location.search) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function UnsavedChangesProvider({ children, navigate }: { children: ReactNode; navigate: (href: string) => void }) {
  const t = useTranslations("admin.ui.unsaved");
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const dirty = dirtyIds.size > 0;

  const registry = useMemo<Registry>(
    () => ({
      setDirty: (id, isDirty) =>
        setDirtyIds((previous) => {
          if (previous.has(id) === isDirty) return previous;
          const next = new Set(previous);
          if (isDirty) next.add(id);
          else next.delete(id);
          return next;
        }),
    }),
    [],
  );

  useEffect(() => {
    if (!dirty) return;
    // Capture phase on the document runs before next/link's own click handler, which then sees defaultPrevented.
    const onClick = (event: MouseEvent) => {
      const href = guardedLinkTarget(event);
      if (href === null) return;
      event.preventDefault();
      setPendingHref(href);
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need returnValue set to show the prompt.
      event.returnValue = "";
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty]);

  return (
    <UnsavedChangesContext.Provider value={registry}>
      {children}
      <ConfirmDialog
        open={pendingHref !== null}
        onOpenChange={(open) => {
          if (!open) setPendingHref(null);
        }}
        title={t("title")}
        description={t("body")}
        confirmLabel={t("leave")}
        cancelLabel={t("stay")}
        tone="danger"
        onConfirm={() => {
          const href = pendingHref;
          setPendingHref(null);
          setDirtyIds(new Set());
          if (href !== null) navigate(href);
        }}
      />
    </UnsavedChangesContext.Provider>
  );
}

/** Marks the calling form as having unsaved changes while `dirty` (no-op outside UnsavedChangesProvider). */
export function useUnsavedChanges(dirty: boolean) {
  const registry = useContext(UnsavedChangesContext);
  const id = useId();
  useEffect(() => {
    registry?.setDirty(id, dirty);
    return () => registry?.setDirty(id, false);
  }, [registry, id, dirty]);
}
