"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { BOOKINGS_PATH, withQuery } from "@/lib/admin/dashboard";
import { useAdminSession } from "@/lib/admin/session";

/** Longest search the A03 list keeps (lib/admin/bookings/filters.ts). */
const MAX_LENGTH = 100;

/**
 * The top bar's search (spec §17 "global search"; design AdminOverview.dc.html): opens the A03 bookings list searched
 * by the term. The list searches by booking reference or phone today; names and addresses join when the A07 customer
 * search exists. Shown to users who read bookings.
 */
export function GlobalSearch() {
  const { can } = useAdminSession();
  if (!can("bookings.view")) return null;
  return <SearchForm />;
}

function SearchForm() {
  const t = useTranslations("admin.globalSearch");
  const router = useRouter();
  const id = useId();
  const [term, setTerm] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const search = term.trim();
    if (!search) return;
    router.push(withQuery(BOOKINGS_PATH, { search }));
  };

  return (
    <form role="search" onSubmit={submit} className="relative hidden w-full max-w-xs min-w-0 items-center md:flex">
      <label htmlFor={id} className="sr-only">
        {t("label")}
      </label>
      <Search aria-hidden className="pointer-events-none absolute start-2.5 size-4 text-ink-600" strokeWidth={1.75} />
      <input
        id={id}
        type="search"
        value={term}
        maxLength={MAX_LENGTH}
        onChange={(e) => setTerm(e.target.value)}
        placeholder={t("placeholder")}
        autoComplete="off"
        enterKeyHint="search"
        className="h-9 w-full min-w-0 rounded-md border border-line-strong bg-surface ps-8 pe-2 text-sm text-ink-900 placeholder:text-ink-600"
      />
    </form>
  );
}
