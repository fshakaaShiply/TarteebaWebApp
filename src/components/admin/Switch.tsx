"use client";

import clsx from "clsx";
import { useId, type ReactNode } from "react";

type SwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  /** Text next to the track, e.g. "On" / "Off". */
  stateLabel?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
};

/** On/off switch (role="switch"): Space/Enter toggles, the label is the accessible name. */
export function Switch({ checked, onCheckedChange, label, description, stateLabel, disabled, id, className }: SwitchProps) {
  const autoId = useId();
  const switchId = id ?? autoId;
  return (
    <div className={clsx("flex items-center justify-between gap-4", className)}>
      <div className="flex flex-col">
        <label htmlFor={switchId} className="text-sm font-medium text-ink-900">
          {label}
        </label>
        {description && (
          <span id={`${switchId}-desc`} className="text-xs text-ink-600">
            {description}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {stateLabel && (
          <span aria-hidden className="text-sm text-ink-600">
            {stateLabel}
          </span>
        )}
        <button
          id={switchId}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-describedby={description ? `${switchId}-desc` : undefined}
          disabled={disabled}
          onClick={() => onCheckedChange(!checked)}
          className={clsx(
            "touch-target inline-flex h-7 w-12 shrink-0 items-center rounded-pill p-0.5 transition-colors disabled:opacity-50",
            checked ? "bg-petrol-700" : "bg-line-strong",
          )}
        >
          <span
            aria-hidden
            className={clsx(
              "size-6 rounded-pill bg-surface shadow-card transition-transform",
              checked ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0",
            )}
          />
        </button>
      </div>
    </div>
  );
}
