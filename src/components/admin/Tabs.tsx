"use client";

import clsx from "clsx";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type TabItem = { value: string; label: ReactNode; disabled?: boolean };

type TabsProps = {
  /** Unique prefix for the tab/panel ids. */
  id: string;
  label: string;
  items: readonly TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
};

export const tabId = (id: string, value: string) => `${id}-tab-${value}`;
export const panelId = (id: string, value: string) => `${id}-panel-${value}`;

/**
 * Segmented tabs (design: A11 tab strip). Arrow keys move between tabs and follow the reading direction
 * (in Arabic, ArrowLeft goes to the next tab), Home/End jump to the ends; only the selected tab is in the tab order.
 */
export function Tabs({ id, label, items, value, onValueChange, className }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = items.filter((i) => !i.disabled);
    const index = enabled.findIndex((i) => i.value === value);
    if (index < 0) return;
    const rtl = listRef.current ? getComputedStyle(listRef.current).direction === "rtl" : false;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = rtl ? index - 1 : index + 1;
    else if (e.key === "ArrowLeft") next = rtl ? index + 1 : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    if (next === null) return;
    e.preventDefault();
    const target = enabled[(next + enabled.length) % enabled.length];
    onValueChange(target.value);
    listRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(id, target.value))}`)?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={clsx("flex flex-wrap gap-1 self-start rounded-md bg-neutral-100 p-1", className)}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            id={tabId(id, item.value)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(id, item.value)}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onValueChange(item.value)}
            className={clsx(
              "touch-target h-9 rounded-sm px-3 text-sm transition-colors disabled:opacity-50",
              selected ? "bg-surface font-bold text-petrol-700 shadow-card" : "font-medium text-ink-600 hover:text-ink-900",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  id,
  value,
  children,
  className,
  hidden,
}: {
  id: string;
  value: string;
  children: ReactNode;
  className?: string;
  /** Keeps an inactive panel mounted (its state, e.g. unsaved form edits, survives a tab switch) but hidden. */
  hidden?: boolean;
}) {
  return (
    <div
      role="tabpanel"
      id={panelId(id, value)}
      aria-labelledby={tabId(id, value)}
      tabIndex={0}
      hidden={hidden}
      className={className}
    >
      {children}
    </div>
  );
}
