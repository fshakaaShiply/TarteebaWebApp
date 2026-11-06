import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { adminKeys } from "@/lib/admin/keys";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import { subscriptionDetail } from "@/test/subscriptionFixtures";
import { useBookingRefresh } from "../../bookings/_components/refresh";
import { useSubscriptionRefresh } from "./kit";

/** Pages loaded a moment ago (the app-wide staleTime is 30 s), as a user going back and forth between A08 and A09 has them. */
function seeded() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  queryClient.setQueryData(adminKeys.payment(55), { id: 55, refundable_fils: 96000 });
  queryClient.setQueryData(adminKeys.refundList({ page: 1 }), { data: [] });
  queryClient.setQueryData(subscriptionKeys.detail(31), subscriptionDetail());
  queryClient.setQueryData(adminKeys.booking(90), { id: 90 });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  const invalidated = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated ?? false;
  return { queryClient, wrapper, invalidated };
}

describe("refresh between A08, A09 and the bookings", () => {
  it("after an A08 action, A09's payments and refunds are read again (a cancellation refunds, a renewal charges)", () => {
    const { wrapper, invalidated } = seeded();
    const { result } = renderHook(() => useSubscriptionRefresh(), { wrapper });
    result.current(subscriptionDetail({ status: "cancelled" }));
    expect(invalidated(adminKeys.payment(55))).toBe(true);
    expect(invalidated(adminKeys.refundList({ page: 1 }))).toBe(true);
    expect(invalidated(adminKeys.booking(90))).toBe(true);
  });

  it("after a booking action (A03 assignment, an A04 move of a series visit), A08 is read again", () => {
    const { wrapper, invalidated } = seeded();
    const { result } = renderHook(() => useBookingRefresh(), { wrapper });
    result.current();
    expect(invalidated(subscriptionKeys.detail(31))).toBe(true);
    expect(invalidated(adminKeys.booking(90))).toBe(true);
  });
});
