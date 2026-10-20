import type { ReactNode } from "react";

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1120px] px-4 sm:px-6 ${className}`}>{children}</div>;
}

export function SectionHeading({ title, body, id }: { title: string; body?: string; id?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2 id={id} className="text-[28px]/[38px] font-bold text-ink-900 sm:text-[34px]/[46px]">
        {title}
      </h2>
      {body && <p className="mt-3 text-base/7 text-ink-600 sm:text-lg/8">{body}</p>}
    </div>
  );
}
