"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card, EmptyState, ErrorState, LoadingBlock, Notice, TextArea, useToast } from "@/components/admin";
import { Pagination } from "@/components/admin/DataTable";
import { addCustomerNote, fetchCustomerNotes } from "@/lib/admin/customers/endpoints";
import { useCustomerError } from "@/lib/admin/customers/errors";
import { FormProblem, NOTE_MAX, checkNote, type FormError } from "@/lib/admin/customers/forms";
import { customerKeys } from "@/lib/admin/customers/keys";
import { useCustomerText } from "@/lib/admin/customers/text";
import type { CustomerDetail } from "@/lib/admin/customers/types";

const PER_PAGE = 20;

/**
 * Internal notes (design: «ملاحظات داخلية (لا تظهر للعميل)»; customers.view reads, customers.notes writes): append-only,
 * newest first, each with its author, the author's role and the time. They never reach the customer in any message, and a
 * deleted account's notes are gone (the API answers none). A note cannot be edited or deleted.
 */
export function CustomerNotesPanel({ customer }: { customer: CustomerDetail }) {
  const t = useTranslations("admin.customers.notes");
  const text = useCustomerText();
  const describe = useCustomerError();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [body, setBody] = useState("");
  const [error, setError] = useState<FormError | null>(null);
  const gone = customer.status === "deleted";

  const notes = useQuery({
    queryKey: customerKeys.notes(customer.id, page),
    queryFn: () => fetchCustomerNotes(customer.id, { page, perPage: PER_PAGE }),
    placeholderData: keepPreviousData,
    enabled: !gone,
  });

  const add = useMutation({
    mutationFn: () => {
      const problem = checkNote(body);
      if (problem) throw new FormProblem("body", problem);
      return addCustomerNote(customer.id, body.trim());
    },
    onSuccess: () => {
      setBody("");
      setPage(1);
      void queryClient.invalidateQueries({ queryKey: ["admin", "customers", "notes", customer.id] });
      void queryClient.invalidateQueries({ queryKey: customerKeys.detail(customer.id) });
      // Said in the toast's live region: the list may refresh only after a while, or out of sight.
      toast.success(t("added"));
    },
    onError: (e) => {
      if (e instanceof FormProblem) setError(e.error);
    },
  });
  const shown = add.isError && !(add.error instanceof FormProblem) ? add.error : null;

  return (
    <Card title={t("title")}>
      <p className="text-xs text-ink-600">{t("hint")}</p>
      {gone ? (
        <EmptyState title={t("deleted")} />
      ) : (
        <>
          {customer.actions.add_note && (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                add.mutate();
              }}
              noValidate
            >
              <TextArea
                label={t("add")}
                rows={3}
                maxLength={NOTE_MAX + 200}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                error={error ? t(`errors.${error}`, { max: NOTE_MAX }) : undefined}
              />
              {shown && <Notice tone="danger">{describe(shown)}</Notice>}
              <div>
                <Button type="submit" loading={add.isPending}>
                  {t("save")}
                </Button>
              </div>
            </form>
          )}
          {notes.isPending ? (
            <LoadingBlock lines={3} />
          ) : notes.isError && !notes.data ? (
            <ErrorState error={notes.error} onRetry={() => void notes.refetch()} />
          ) : notes.data && notes.data.data.length === 0 ? (
            <EmptyState title={t("empty")} />
          ) : (
            notes.data && (
              <>
                <ul className="flex flex-col divide-y divide-line">
                  {notes.data.data.map((n) => (
                    <li key={n.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                      <p className="whitespace-pre-line text-sm/6 text-ink-900">{n.body}</p>
                      <p className="text-xs text-ink-600">
                        {n.author.name}
                        {n.author.roles.length > 0 && ` (${text.list(n.author.roles.map((r) => text.name(r.label)))})`} · {text.dateTime(n.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
                <Pagination meta={notes.data.meta} onPageChange={setPage} />
              </>
            )
          )}
        </>
      )}
    </Card>
  );
}
