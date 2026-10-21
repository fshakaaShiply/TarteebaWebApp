import clsx from "clsx";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import type { ComponentPropsWithRef, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  // One primary action per screen (design system): petrol with white text.
  primary: "bg-petrol-700 text-white hover:bg-petrol-800 hover:text-white",
  secondary: "border-[1.5px] border-petrol-700 bg-surface text-petrol-700 hover:bg-petrol-50 hover:text-petrol-800",
  outline: "border border-line-strong bg-surface text-ink-900 hover:bg-neutral-100 hover:text-ink-900",
  ghost: "text-petrol-700 hover:bg-petrol-50 hover:text-petrol-800",
  danger: "bg-danger-700 text-white hover:bg-danger-700/90 hover:text-white",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 gap-1.5 rounded-sm px-3 text-sm",
  md: "h-10 gap-2 rounded-md px-4 text-sm",
  lg: "h-12 gap-2 rounded-md px-5 text-base",
};

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return clsx(
    "inline-flex shrink-0 items-center justify-center font-bold whitespace-nowrap transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60",
    variants[variant],
    sizes[size],
    className,
  );
}

type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, keeps the label for screen readers and blocks clicks. */
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, className)}
      {...props}
    >
      {loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

type ButtonLinkProps = ComponentPropsWithRef<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode };

export function ButtonLink({ variant = "primary", size = "md", icon, className, children, ...props }: ButtonLinkProps) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...props}>
      {icon}
      {children}
    </Link>
  );
}

/** Square icon-only button; `label` is the accessible name. */
export function IconButton({
  label,
  className,
  children,
  type = "button",
  ...props
}: ComponentPropsWithRef<"button"> & { label: string }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={clsx(
        "touch-target inline-flex size-10 shrink-0 items-center justify-center rounded-md text-ink-900 transition-colors hover:bg-neutral-100 disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
