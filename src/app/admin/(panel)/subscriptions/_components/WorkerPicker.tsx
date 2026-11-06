"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Select } from "@/components/admin";
import { fetchWorkerCandidates } from "@/lib/admin/subscriptions/endpoints";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import type { CandidateRole, WorkerCandidate } from "@/lib/admin/subscriptions/types";

/**
 * GET …/worker-candidates?role=&from= with the picker's own key, so a dialog that needs a worker's name (an answer that
 * gives only her id) reads the list the picker already loaded instead of asking again.
 */
export function useWorkerCandidates(subscriptionId: number, role: CandidateRole, from?: string, enabled = true) {
  return useQuery({
    queryKey: subscriptionKeys.candidates(subscriptionId, role, from ?? ""),
    queryFn: () => fetchWorkerCandidates(subscriptionId, role, from),
    staleTime: 30_000,
    retry: false,
    enabled,
  });
}

/** The name of a worker id among loaded candidate lists, or null. */
export function candidateName(id: number | null | undefined, ...lists: (readonly WorkerCandidate[] | undefined)[]): string | null {
  if (id === null || id === undefined) return null;
  for (const list of lists) {
    const found = list?.find((c) => c.worker.id === id);
    if (found) return found.worker.name;
  }
  return null;
}

/**
 * The workers who can take a role of this subscription (GET …/worker-candidates?role=&from=): each with how many of the
 * next 28 days' visits she fits, the best first; the one already named is marked. Whether she fits a given day is
 * the API's answer (the confirm, assign and Live-out day previews), never the client's.
 */
export function WorkerPicker({
  subscriptionId,
  role,
  from,
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  required,
  excludeId,
  disabled,
}: {
  subscriptionId: number;
  role: CandidateRole;
  from?: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  error?: ReactNode;
  hint?: ReactNode;
  placeholder?: string;
  required?: boolean;
  /** A worker already in the other role is left out. */
  excludeId?: number | null;
  disabled?: boolean;
}) {
  const t = useTranslations("admin.subscriptions.workers");
  const query = useWorkerCandidates(subscriptionId, role, from);
  const options = (query.data ?? [])
    .filter((c) => c.worker.id !== excludeId)
    .map((c) => ({
      value: String(c.worker.id),
      label: [c.worker.name, t("fits", { fits: c.fits, of: c.of }), c.current ? t("current") : null].filter(Boolean).join(" · "),
    }));
  const state = query.isPending ? (
    t("loading")
  ) : query.isError ? (
    <>
      {t("loadError")}{" "}
      <button type="button" className="touch-target font-bold text-petrol-700 underline" onClick={() => void query.refetch()}>
        {t("retry")}
      </button>
    </>
  ) : options.length === 0 ? (
    t("none")
  ) : undefined;
  return (
    <Select
      label={label}
      required={required}
      placeholder={placeholder ?? t("choose")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={options}
      error={error}
      hint={state ?? hint}
      disabled={disabled || query.isPending}
    />
  );
}
