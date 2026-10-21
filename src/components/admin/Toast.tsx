"use client";

import clsx from "clsx";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastTone = "success" | "error" | "info";

type ToastItem = { id: number; tone: ToastTone; message: ReactNode };

type ToastApi = {
  show: (message: ReactNode, tone?: ToastTone) => void;
  success: (message: ReactNode) => void;
  error: (message: ReactNode) => void;
  info: (message: ReactNode) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const DURATION_MS = 5000;

const tones: Record<ToastTone, { box: string; Icon: typeof Info }> = {
  success: { box: "bg-sage-100 text-success-700", Icon: CircleCheck },
  error: { box: "bg-danger-50 text-danger-700", Icon: CircleAlert },
  info: { box: "bg-info-50 text-info-700", Icon: Info },
};

/** Short confirmations after an action ("Setting saved"). Errors are announced assertively, the rest politely. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("admin.ui");
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((i) => i.id !== id)), []);

  const show = useCallback(
    (message: ReactNode, tone: ToastTone = "success") => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-2), { id, tone, message }]);
      setTimeout(() => dismiss(id), tone === "error" ? DURATION_MS * 2 : DURATION_MS);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m) => show(m, "success"),
      error: (m) => show(m, "error"),
      info: (m) => show(m, "info"),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
        <div role="status" aria-live="polite" className="contents">
          {items
            .filter((i) => i.tone !== "error")
            .map((item) => (
              <ToastView key={item.id} item={item} onDismiss={dismiss} closeLabel={t("close")} />
            ))}
        </div>
        <div role="alert" aria-live="assertive" className="contents">
          {items
            .filter((i) => i.tone === "error")
            .map((item) => (
              <ToastView key={item.id} item={item} onDismiss={dismiss} closeLabel={t("close")} />
            ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ item, onDismiss, closeLabel }: { item: ToastItem; onDismiss: (id: number) => void; closeLabel: string }) {
  const { box, Icon } = tones[item.tone];
  return (
    <div
      className={clsx(
        "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-md px-4 py-3 text-sm font-medium shadow-card",
        box,
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
      <div className="flex-1">{item.message}</div>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label={closeLabel}
        className="-m-1 rounded-sm p-1 opacity-80 hover:opacity-100"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
