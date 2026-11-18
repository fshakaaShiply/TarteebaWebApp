"use client";

import clsx from "clsx";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useAdminSession } from "@/lib/admin/session";

/** The A07 profile of a customer: /admin/customers/{ULID} (P5-X11: every admin page binds customers by ULID). */
export const CUSTOMERS_PATH = "/admin/customers";

/** A ULID is 26 characters of Crockford base32 (no I, L, O, U). The API's numeric ids never open a profile. */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

export function isCustomerUlid(value: unknown): value is string {
  return typeof value === "string" && ULID.test(value);
}

/**
 * A customer's name (or phone) as a link to their A07 profile: the one link every screen uses (booking, subscription,
 * payment, refund, complaint, compensation, waitlist). Staff without `customers.view` get the same text unlinked, so
 * nothing a screen shows depends on the link; a customer without a usable ULID (a numeric id from an older answer, a
 * deleted account) is plain text as well. The label is whatever the answer carried (a name, a masked phone), so
 * nothing is looked up here.
 */
export function CustomerLink({
  customer,
  children,
  className,
}: {
  /** The answer's customer: `id` is the ULID; `name` the display name, null for an account that is gone. */
  customer: { id: string | number | null | undefined; name?: string | null; phone?: string | null } | null | undefined;
  /** Overrides the text (for example the name plus a reference). */
  children?: ReactNode;
  className?: string;
}) {
  const t = useTranslations("admin.ui.customerLink");
  const { can } = useAdminSession();
  const phone = customer?.phone ? (
    <bdi dir="ltr" className="font-latin">
      {customer.phone}
    </bdi>
  ) : null;
  const label = children ?? customer?.name ?? phone ?? t("unnamed");
  const href = customer && isCustomerUlid(customer.id) && can("customers.view") ? `${CUSTOMERS_PATH}/${customer.id}` : null;

  if (!href) return <span className={className}>{label}</span>;
  return (
    <Link href={href} className={clsx("font-medium text-petrol-700 underline-offset-2 hover:underline", className)}>
      {label}
    </Link>
  );
}
