"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card, EmptyState, ErrorState, LoadingBlock, StatusBadge, TabPanel, Tabs, type TabItem } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { fetchCustomer } from "@/lib/admin/customers/endpoints";
import { customerKeys } from "@/lib/admin/customers/keys";
import { customerToneOf } from "@/lib/admin/customers/status";
import { useCustomerText } from "@/lib/admin/customers/text";
import type { CustomerAddress, CustomerDetail } from "@/lib/admin/customers/types";
import { fetchCustomerWallet } from "@/lib/admin/finance/endpoints";
import { showWalletPanel } from "@/lib/admin/finance/wallet";
import { adminKeys } from "@/lib/admin/keys";
import { useAdminSession } from "@/lib/admin/session";
import { isCustomerUlid } from "@/components/admin/CustomerLink";
import { RequirePermission } from "../../../_components/RequirePermission";
import { Ltr } from "../../bookings/_components/BookingBits";
import { WalletPanel } from "../../finance/_components/WalletPanel";
import { BlockCustomerDialog } from "../_components/BlockCustomerDialog";
import { CreatePrivacyRequestDialog } from "../_components/CreatePrivacyRequestDialog";
import { BlockedBanner, DeletedBanner, DeletionBanner } from "../_components/CustomerParts";
import { CustomerNotesPanel } from "../_components/CustomerNotesPanel";
import { CustomerActivityTable, CustomerPaymentsTab, CustomerPrivacyPanel, CustomerQualityTab } from "../_components/LinkedLists";
import { CustomerAddresses, CustomerConsents, CustomerProfileCard } from "../_components/ProfileCards";
import { BlockAddressDialog, MarketingOptOutDialog } from "../_components/ReasonDialogs";
import { useCustomerActivity } from "../_components/useCustomerActivity";

const TAB_ID = "customer";
type TabId = "overview" | "payments" | "quality" | "balance" | "privacy";

type Dialog =
  | { kind: "block" | "unblock" }
  | { kind: "address"; addressId: string; mode: "block" | "unblock" }
  | { kind: "optOut" }
  | { kind: "privacy" };

/**
 * A07 profile (spec §17 A07; design AdminCustomers.dc.html; customers.view): who she is and what she did, in the design's
 * two columns (profile card and recent bookings and subscriptions; internal notes), the block state, and tabs for what
 * other modules own: payments (payments.view), cases and ratings (complaints.manage), the balance (the finance wallet
 * panel while the balance is on or has money in it) and privacy. A tab the staff member has no permission for is not
 * rendered; the API refuses it anyway. A deleted account is read-only and holds no personal data.
 */
export function CustomerDetailScreen({ id }: { id: string }) {
  return (
    <RequirePermission anyOf={["customers.view"]}>
      <CustomerPage id={id} />
    </RequirePermission>
  );
}

function CustomerPage({ id }: { id: string }) {
  const t = useTranslations("admin.customers.detail");
  const valid = isCustomerUlid(id);
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: customerKeys.detail(id),
    queryFn: () => fetchCustomer(id),
    enabled: valid,
    refetchOnWindowFocus: true,
  });
  const notFound = !valid || (detail.error instanceof AdminApiError && detail.error.status === 404);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/admin/customers" className="inline-flex w-fit items-center gap-1 text-sm font-medium">
          <ChevronRight aria-hidden className="size-4 ltr:rotate-180" />
          {t("back")}
        </Link>
        {detail.data && (
          <Button variant="ghost" size="sm" onClick={() => void queryClient.invalidateQueries({ queryKey: customerKeys.all })} loading={detail.isFetching} icon={<RefreshCw aria-hidden className="size-4" />}>
            {t("refresh")}
          </Button>
        )}
      </div>
      {notFound ? (
        <Card>
          <EmptyState title={t("notFound")} />
        </Card>
      ) : detail.isPending ? (
        <LoadingBlock lines={10} className="rounded-lg bg-surface p-5 shadow-card" />
      ) : detail.isError && !detail.data ? (
        <Card>
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        </Card>
      ) : (
        <CustomerView customer={detail.data!} refreshFailed={detail.isError} />
      )}
    </>
  );
}

function CustomerView({ customer, refreshFailed }: { customer: CustomerDetail; refreshFailed: boolean }) {
  const t = useTranslations("admin.customers.detail");
  const text = useCustomerText();
  const { can } = useAdminSession();
  const gone = customer.status === "deleted";
  const [tab, setTab] = useState<TabId>("overview");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const activity = useCustomerActivity(customer);

  // The balance tab needs to know whether the balance is on or holds money; the panel reads the same answer (same key).
  const wallet = useQuery({
    queryKey: adminKeys.customerWallet(customer.id, 1),
    queryFn: () => fetchCustomerWallet(customer.id, { page: 1, perPage: 25 }),
    enabled: customer.links.wallet !== null && !gone,
  });
  const showBalance = customer.links.wallet !== null && !gone && showWalletPanel(wallet.data?.data);

  const items: TabItem[] = [
    { value: "overview", label: t("tabs.overview") },
    ...(customer.links.payments && !gone ? [{ value: "payments", label: t("tabs.payments") }] : []),
    // The accountant reads cases through the API's link, but the design gives the tab to those who work them (complaints.manage).
    ...(customer.links.complaints && can("complaints.manage") && !gone ? [{ value: "quality", label: t("tabs.quality") }] : []),
    ...(showBalance ? [{ value: "balance", label: t("tabs.balance") }] : []),
    { value: "privacy", label: t("tabs.privacy") },
  ];
  // A tab that went away (the balance switched off, a link gone after a refresh) falls back to the overview.
  const current: TabId = items.some((i) => i.value === tab) ? tab : "overview";

  // The dialog follows the address as the profile holds it now; the click's copy stands in if it is gone.
  const addressOf = (addressId: string): CustomerAddress | undefined => customer.addresses.find((a) => a.id === addressId);

  return (
    <>
      <section aria-labelledby="customer-title" className="flex flex-col gap-3 rounded-lg bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 id="customer-title" className="text-[26px]/[34px] font-bold text-ink-900">
              {customer.name || (gone ? t("deletedCustomer") : t("noName"))}
            </h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge tone={customerToneOf(customer.status)}>{text.status(customer.status, customer.status_label)}</StatusBadge>
            </div>
            {(customer.phone || customer.email) && (
              <p className="text-sm text-ink-600">
                {customer.phone && <Ltr>{customer.phone}</Ltr>}
                {customer.phone && customer.email && " · "}
                {customer.email && <Ltr>{customer.email}</Ltr>}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {customer.actions.block && (
              <Button variant="outline" className="text-danger-700" onClick={() => setDialog({ kind: "block" })}>
                {t(customer.status === "blocked" ? "changeReason" : "block")}
              </Button>
            )}
            {customer.actions.unblock && (
              <Button variant="secondary" onClick={() => setDialog({ kind: "unblock" })}>
                {t("unblock")}
              </Button>
            )}
          </div>
        </div>
        <BlockedBanner customer={customer} />
        <DeletionBanner customer={customer} />
        <DeletedBanner customer={customer} />
        {refreshFailed && <p className="text-xs text-warning-700">{t("refreshFailed")}</p>}
      </section>

      <Tabs id={TAB_ID} label={t("tabsLabel")} items={items} value={current} onValueChange={(v) => setTab(v as TabId)} />
      <TabPanel id={TAB_ID} value={current} className="flex flex-col gap-4 outline-none">
        {current === "overview" && (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              <CustomerProfileCard customer={customer} />
              {activity.enabled && <CustomerActivityTable rows={activity.rows} pending={activity.pending} error={activity.error} onRetry={activity.retry} />}
              <CustomerAddresses customer={customer} onBlock={(address, mode) => setDialog({ kind: "address", addressId: address.id, mode })} />
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <CustomerNotesPanel customer={customer} />
            </div>
          </div>
        )}
        {current === "payments" && <CustomerPaymentsTab customer={customer} />}
        {current === "quality" && <CustomerQualityTab customer={customer} />}
        {current === "balance" && <WalletPanel customerUlid={customer.id} />}
        {current === "privacy" && (
          <>
            <CustomerConsents customer={customer} />
            <CustomerPrivacyPanel customer={customer} onCreate={() => setDialog({ kind: "privacy" })} onOptOut={() => setDialog({ kind: "optOut" })} />
          </>
        )}
      </TabPanel>

      {(dialog?.kind === "block" || dialog?.kind === "unblock") && <BlockCustomerDialog customer={customer} mode={dialog.kind} openItems={activity.openItems} onClose={() => setDialog(null)} />}
      {dialog?.kind === "address" && addressOf(dialog.addressId) && (
        <BlockAddressDialog customerUlid={customer.id} address={addressOf(dialog.addressId)!} mode={dialog.mode} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "optOut" && <MarketingOptOutDialog customer={customer} onClose={() => setDialog(null)} />}
      {dialog?.kind === "privacy" && <CreatePrivacyRequestDialog customer={customer} onClose={() => setDialog(null)} />}
    </>
  );
}
