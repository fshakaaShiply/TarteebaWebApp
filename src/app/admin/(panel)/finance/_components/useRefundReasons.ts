"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchRefundReasons } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";

/**
 * GET /admin/refund-reasons (refunds.create or payments.view): the codes, their labels in both languages, which ones
 * staff may pick and which need a note. The list changes only with the API's configuration, so it is kept a while.
 */
export function useRefundReasons() {
  return useQuery({ queryKey: adminKeys.refundReasons(), queryFn: fetchRefundReasons, staleTime: 5 * 60_000 });
}
