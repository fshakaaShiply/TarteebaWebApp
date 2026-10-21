"use client";

import clsx from "clsx";
import { useId, type ComponentPropsWithRef, type ReactNode } from "react";

/*
 * Form fields: label above, optional hint, error below (design system TextField). Every control is labelled and
 * points at its hint/error with aria-describedby; aria-invalid drives the error border.
 */

export const controlClasses =
  "w-full rounded-sm border border-line-strong bg-surface px-3 text-[15px] text-ink-900 placeholder:text-ink-600/70 " +
  "aria-invalid:border-danger-700 disabled:bg-neutral-100 disabled:text-ink-600";

// Only for text inputs and textareas (a <select> always matches :read-only).
const readOnlyClasses = "read-only:bg-neutral-100";

type FieldShellProps = {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
};

export function fieldDescribedBy(id: string, hint?: ReactNode, error?: ReactNode): string | undefined {
  const ids = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

export function FieldShell({ id, label, hint, error, required, className, children }: FieldShellProps) {
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink-900">
        {label}
        {required && (
          <span aria-hidden className="ms-0.5 text-danger-700">
            *
          </span>
        )}
      </label>
      {children}
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

type TextFieldProps = Omit<ComponentPropsWithRef<"input">, "size"> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Text shown inside the field at the end, e.g. a currency. */
  suffix?: ReactNode;
  containerClassName?: string;
};

export function TextField({
  label,
  hint,
  error,
  suffix,
  id,
  className,
  containerClassName,
  required,
  ...props
}: TextFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required} className={containerClassName}>
      <div className="relative">
        <input
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescribedBy(fieldId, hint, error)}
          aria-required={required || undefined}
          className={clsx(controlClasses, readOnlyClasses, "h-11", suffix ? "pe-14" : null, className)}
          {...props}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm text-ink-600">
            {suffix}
          </span>
        )}
      </div>
    </FieldShell>
  );
}

type TextAreaProps = ComponentPropsWithRef<"textarea"> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  containerClassName?: string;
};

export function TextArea({ label, hint, error, id, className, containerClassName, required, ...props }: TextAreaProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required} className={containerClassName}>
      <textarea
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={fieldDescribedBy(fieldId, hint, error)}
        aria-required={required || undefined}
        className={clsx(controlClasses, readOnlyClasses, "min-h-24 py-2.5 leading-6", className)}
        {...props}
      />
    </FieldShell>
  );
}

type SelectProps = ComponentPropsWithRef<"select"> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  options: readonly { value: string; label: string }[];
  /** Adds a first option with an empty value (e.g. "All roles"). */
  placeholder?: string;
  containerClassName?: string;
};

export function Select({
  label,
  hint,
  error,
  options,
  placeholder,
  id,
  className,
  containerClassName,
  required,
  ...props
}: SelectProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required} className={containerClassName}>
      <select
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={fieldDescribedBy(fieldId, hint, error)}
        aria-required={required || undefined}
        className={clsx(controlClasses, "h-11 pe-8", className)}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

type CheckboxProps = Omit<ComponentPropsWithRef<"input">, "type"> & { label: ReactNode; description?: ReactNode };

export function Checkbox({ label, description, id, className, ...props }: CheckboxProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className={clsx("flex items-start gap-2.5", className)}>
      <input
        id={fieldId}
        type="checkbox"
        aria-describedby={description ? `${fieldId}-desc` : undefined}
        className="mt-0.5 size-4.5 shrink-0 accent-petrol-700"
        {...props}
      />
      <label htmlFor={fieldId} className="flex flex-col text-sm">
        <span className="font-medium text-ink-900">{label}</span>
        {description && (
          <span id={`${fieldId}-desc`} className="text-xs text-ink-600">
            {description}
          </span>
        )}
      </label>
    </div>
  );
}

/** A group of checkboxes with one legend and one error (e.g. roles). */
export function CheckboxGroup({
  legend,
  hint,
  error,
  children,
  className,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <fieldset
      aria-describedby={fieldDescribedBy(id, hint, error)}
      aria-invalid={error ? true : undefined}
      className={clsx("flex flex-col gap-2", className)}
    >
      <legend className="mb-1.5 text-sm font-medium text-ink-900">{legend}</legend>
      {children}
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
    </fieldset>
  );
}
