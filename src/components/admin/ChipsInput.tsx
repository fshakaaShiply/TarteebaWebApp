"use client";

import clsx from "clsx";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { Button } from "./Button";
import { controlClasses, fieldDescribedBy } from "./Field";

type ChipsInputProps = {
  label: ReactNode;
  value: readonly string[];
  onChange: (value: string[]) => void;
  hint?: ReactNode;
  error?: ReactNode;
  placeholder?: string;
  /** Direction of the typed values (e.g. "ltr" for codes and phone prefixes). */
  valueDir?: "ltr" | "rtl" | "auto";
  /**
   * The text input. Pass react-hook-form's `field.ref` from a Controller so a failed submit can focus the list when
   * its error is the first one (the input carries aria-invalid and the error).
   */
  ref?: Ref<HTMLInputElement>;
  onBlur?: () => void;
};

/** A list of short strings as removable chips; Enter or the add button adds the typed value. */
export function ChipsInput({ label, value, onChange, hint, error, placeholder, valueDir = "auto", ref, onBlur }: ChipsInputProps) {
  const t = useTranslations("admin.ui");
  const id = useId();
  const [draft, setDraft] = useState("");

  const add = () => {
    const v = draft.trim();
    if (v === "") return;
    if (!value.includes(v)) onChange([...value, v]);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink-900">
        {label}
      </label>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={typeof label === "string" ? label : undefined}>
          {value.map((item) => (
            <li
              key={item}
              className="inline-flex items-center gap-1 rounded-pill bg-petrol-50 py-1 ps-3 pe-1 text-sm font-medium text-petrol-700"
            >
              <span dir={valueDir}>{item}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== item))}
                aria-label={t("removeItem", { item })}
                className="touch-target inline-flex size-6 items-center justify-center rounded-pill hover:bg-petrol-700 hover:text-white"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-600">{t("noItems")}</p>
      )}
      <div className="flex gap-2">
        <input
          ref={ref}
          id={id}
          value={draft}
          onBlur={onBlur}
          dir={valueDir}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescribedBy(id, hint, error)}
          className={clsx(controlClasses, "h-11")}
        />
        <Button variant="outline" onClick={add} disabled={draft.trim() === ""} icon={<Plus aria-hidden className="size-4" />}>
          {t("add")}
        </Button>
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-ink-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
}
