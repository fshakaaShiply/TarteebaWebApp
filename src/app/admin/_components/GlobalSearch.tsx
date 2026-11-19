"use client";

import { Search, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { BOOKINGS_PATH, withQuery } from "@/lib/admin/dashboard";
import { CUSTOMERS_LIST_PATH } from "@/lib/admin/nav";
import { useAdminSession } from "@/lib/admin/session";

/** Longest search the A03 and A07 lists keep (lib/admin/bookings/filters.ts, customers/filters.ts). */
const MAX_LENGTH = 100;

/**
 * The top bar's search (spec §17 "global search"; design AdminOverview.dc.html). The box opens the A03 bookings list
 * searched by the term (GET /admin/bookings?search=: the booking reference, the phone, the customer's name and the booked
 * address), for users who read bookings. Users who read customers (customers.view) also get "Search customers", which opens
 * the A07 list searched by the same term (?q=: phone, name, e-mail, address, a booking or subscription reference); for a
 * user without bookings.view that is what the box itself does.
 */
export function GlobalSearch() {
  const { can } = useAdminSession();
  const bookings = can("bookings.view");
  const customers = can("customers.view");
  if (!bookings && !customers) return null;
  return <SearchForm bookings={bookings} customers={customers} />;
}

function SearchForm({ bookings, customers }: { bookings: boolean; customers: boolean }) {
  const t = useTranslations("admin.globalSearch");
  const router = useRouter();
  const id = useId();
  const [term, setTerm] = useState("");

  const open = (target: "bookings" | "customers") => {
    const search = term.trim();
    if (!search) return;
    router.push(target === "bookings" ? withQuery(BOOKINGS_PATH, { search }) : withQuery(CUSTOMERS_LIST_PATH, { q: search }));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    open(bookings ? "bookings" : "customers");
  };

  return (
    <form role="search" onSubmit={submit} className="relative hidden w-full max-w-md min-w-0 items-center gap-1.5 md:flex">
      <div className="relative flex min-w-0 flex-1 items-center">
        <label htmlFor={id} className="sr-only">
          {bookings ? t("label") : t("labelCustomers")}
        </label>
        <Search aria-hidden className="pointer-events-none absolute start-2.5 size-4 text-ink-600" strokeWidth={1.75} />
        <input
          id={id}
          type="search"
          value={term}
          maxLength={MAX_LENGTH}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={bookings ? t("placeholder") : t("placeholderCustomers")}
          autoComplete="off"
          enterKeyHint="search"
          className="h-9 w-full min-w-0 rounded-md border border-line-strong bg-surface ps-8 pe-2 text-sm text-ink-900 placeholder:text-ink-600"
        />
      </div>
      {bookings && customers && (
        <button
          type="button"
          onClick={() => open("customers")}
          disabled={term.trim() === ""}
          title={t("customers")}
          className="touch-target inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-sm font-medium text-ink-900 hover:bg-neutral-100 disabled:opacity-50"
        >
          <Users aria-hidden className="size-4" strokeWidth={1.75} />
          {t("customers")}
        </button>
      )}
    </form>
  );
}
