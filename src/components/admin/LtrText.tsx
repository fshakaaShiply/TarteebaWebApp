import clsx from "clsx";
import type { ReactNode } from "react";

/**
 * A left-to-right value (record code, e-mail) on its own line, e.g. under a name in a table cell. The line keeps the
 * page direction, so in Arabic it starts on the right edge like the name above it; only the value is isolated
 * (<bdi dir="ltr">) so its characters keep their order. Putting dir="ltr" on the whole line would push it to the
 * left edge in Arabic.
 */
export function LtrText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={clsx("block", className)}>
      <bdi dir="ltr" className="font-latin">
        {children}
      </bdi>
    </span>
  );
}
