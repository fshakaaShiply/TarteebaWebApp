"use client";

import clsx from "clsx";

/**
 * The cleaner's approved photo (a short-lived signed URL of a private file: a plain <img>, never cached by us, no
 * referrer) or her initial. The image is decorative: her name is always written next to it.
 */
export function WorkerAvatar({ name, url, size = "md", className }: { name: string; url?: string | null; size?: "sm" | "md" | "lg"; className?: string }) {
  const box = size === "lg" ? "size-20 text-3xl" : size === "sm" ? "size-8 text-sm" : "size-10 text-base";
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" referrerPolicy="no-referrer" className={clsx("shrink-0 rounded-full object-cover", box, className)} />;
  }
  const initial = Array.from(name.trim())[0] ?? "";
  return (
    <span aria-hidden className={clsx("inline-flex shrink-0 items-center justify-center rounded-full bg-petrol-50 font-bold text-petrol-700", box, className)}>
      {initial}
    </span>
  );
}
