"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ShieldOff, UserCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  Button,
  Checkbox,
  CheckboxGroup,
  ConfirmDialog,
  Drawer,
  ErrorState,
  LoadingBlock,
  Notice,
  Select,
  StatusBadge,
  TextArea,
  TextField,
  useToast,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import {
  activateStaffUser,
  fetchStaffUser,
  setStaffUserRoles,
  suspendStaffUser,
  updateStaffUser,
} from "@/lib/admin/endpoints";
import { applyFieldErrors, useAdminErrorMessage, useServerFieldMessage } from "@/lib/admin/errors";
import { formatDateTime } from "@/lib/admin/format";
import { adminKeys } from "@/lib/admin/keys";
import { useAdminSession } from "@/lib/admin/session";
import type { StaffUser } from "@/lib/admin/types";
import { UserStatusBadge, isLocked, useRoleName, useRoles } from "./shared";

/*
 * A13 user detail: edit name/phone/language, change roles, suspend (reason required) or reactivate. Edits send the
 * loaded version (If-Match); STALE_VERSION offers a reload. The API guards the last system administrator and
 * self-suspension; those answers are shown as messages.
 */
export function UserDrawer({ initial, onClose }: { initial: StaffUser; onClose: () => void }) {
  const t = useTranslations("admin.users");
  const locale = useLocale();
  const query = useQuery({
    queryKey: adminKeys.staffUser(initial.id),
    queryFn: () => fetchStaffUser(initial.id),
    placeholderData: initial,
  });
  const user = query.data ?? initial;

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={user.name}
      description={
        <span dir="ltr" className="font-latin">
          {user.email}
        </span>
      }
    >
      {query.isError && !query.data ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-md bg-ivory-50 p-4 text-sm">
            <div className="flex flex-col gap-1">
              <dt className="text-ink-600">{t("columns.status")}</dt>
              <dd>
                <UserStatusBadge user={user} />
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-ink-600">{t("columns.twoFactor")}</dt>
              <dd>
                {user.two_factor_enabled ? (
                  <StatusBadge tone="success">{t("twoFactorOn")}</StatusBadge>
                ) : (
                  <StatusBadge tone="neutral">{t("twoFactorOff")}</StatusBadge>
                )}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-ink-600">{t("columns.lastLogin")}</dt>
              <dd className="font-medium">{user.last_login_at ? formatDateTime(user.last_login_at, locale) : t("never")}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-ink-600">{t("createdAt")}</dt>
              <dd className="font-medium">{user.created_at ? formatDateTime(user.created_at, locale) : "—"}</dd>
            </div>
            {isLocked(user) && (
              <div className="col-span-2 flex flex-col gap-1">
                <dt className="text-ink-600">{t("lockedUntil")}</dt>
                <dd className="font-medium">{formatDateTime(user.locked_until, locale)}</dd>
              </div>
            )}
          </dl>

          {/* Remount the forms with fresh values whenever the record changes. */}
          <DetailsForm key={`d${user.version}`} user={user} onReload={() => void query.refetch()} />
          <RolesForm key={`r${user.version}`} user={user} onReload={() => void query.refetch()} />
          <StatusSection user={user} />
        </>
      )}
    </Drawer>
  );
}

function useApplyUser() {
  const queryClient = useQueryClient();
  return (updated: StaffUser) => {
    queryClient.setQueryData(adminKeys.staffUser(updated.id), updated);
    void queryClient.invalidateQueries({ queryKey: [...adminKeys.staffUsers(), "list"] });
    void queryClient.invalidateQueries({ queryKey: adminKeys.roles() });
  };
}

function StaleNotice({ onReload }: { onReload: () => void }) {
  const t = useTranslations("admin.users");
  return (
    <Notice
      tone="warning"
      title={t("stale.title")}
      action={
        <Button variant="outline" size="sm" className="self-start" onClick={onReload} icon={<RefreshCw aria-hidden className="size-4" />}>
          {t("stale.reload")}
        </Button>
      }
    >
      {t("stale.body")}
    </Notice>
  );
}

const detailsSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(32),
  locale: z.enum(["ar", "en"]),
});
type DetailsValues = z.infer<typeof detailsSchema>;

function DetailsForm({ user, onReload }: { user: StaffUser; onReload: () => void }) {
  const t = useTranslations("admin.users");
  const describe = useAdminErrorMessage();
  const serverMessage = useServerFieldMessage();
  const toast = useToast();
  const applyUser = useApplyUser();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm<DetailsValues>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { name: user.name, phone: user.phone ?? "", locale: user.locale === "en" ? "en" : "ar" },
  });

  const save = useMutation({
    mutationFn: (v: DetailsValues) => updateStaffUser(user.id, { ...v, phone: v.phone || null }, user.version),
    onSuccess: (updated) => {
      applyUser(updated);
      toast.success(t("detailsSaved"));
    },
    onError: (error) => applyFieldErrors(error, setError, ["name", "phone", "locale"]),
  });

  const err = save.error instanceof AdminApiError ? save.error : null;
  const fieldError = (field: keyof DetailsValues, fallback: string) => {
    const e = errors[field];
    return e ? (e.type === "server" ? serverMessage(e.message, fallback) : fallback) : undefined;
  };

  return (
    <section aria-labelledby={`details-${user.id}`} className="flex flex-col gap-3">
      <h3 id={`details-${user.id}`} className="text-base font-bold text-ink-900">
        {t("detailsTitle")}
      </h3>
      <form noValidate onSubmit={handleSubmit((v) => save.mutate(v))} className="flex flex-col gap-3">
        <TextField label={t("form.name")} required error={fieldError("name", t("form.nameInvalid"))} {...register("name")} />
        <TextField
          label={t("form.phone")}
          type="tel"
          dir="ltr"
          placeholder="+9715XXXXXXXX"
          className="text-start font-latin"
          hint={t("form.phoneHint")}
          error={fieldError("phone", t("form.phoneInvalid"))}
          {...register("phone")}
        />
        <Select
          label={t("form.locale")}
          options={[
            { value: "ar", label: t("locales.ar") },
            { value: "en", label: t("locales.en") },
          ]}
          {...register("locale")}
        />
        {err?.code === "STALE_VERSION" ? (
          <StaleNotice onReload={onReload} />
        ) : save.error && err?.code !== "VALIDATION_FAILED" ? (
          <Notice tone="danger">{describe(save.error)}</Notice>
        ) : null}
        <Button type="submit" variant="secondary" loading={save.isPending} disabled={!isDirty} className="self-start">
          {t("saveDetails")}
        </Button>
      </form>
    </section>
  );
}

function RolesForm({ user, onReload }: { user: StaffUser; onReload: () => void }) {
  const t = useTranslations("admin.users");
  const describe = useAdminErrorMessage();
  const toast = useToast();
  const applyUser = useApplyUser();
  const roles = useRoles();
  const roleName = useRoleName();
  const [selected, setSelected] = useState<string[]>(user.roles);
  const [confirming, setConfirming] = useState(false);

  const save = useMutation({
    mutationFn: () => setStaffUserRoles(user.id, selected, user.version),
    onSuccess: (updated) => {
      setConfirming(false);
      applyUser(updated);
      toast.success(t("rolesSaved"));
    },
    onError: () => setConfirming(false),
  });

  const added = selected.filter((r) => !user.roles.includes(r));
  const removed = user.roles.filter((r) => !selected.includes(r));
  const changed = added.length > 0 || removed.length > 0;
  const err = save.error instanceof AdminApiError ? save.error : null;

  return (
    <section aria-labelledby={`roles-${user.id}`} className="flex flex-col gap-3 border-t border-line pt-5">
      <h3 id={`roles-${user.id}`} className="text-base font-bold text-ink-900">
        {t("rolesTitle")}
      </h3>
      {roles.isPending ? (
        <LoadingBlock lines={3} />
      ) : roles.isError ? (
        <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />
      ) : (
        <CheckboxGroup legend={<span className="sr-only">{t("rolesTitle")}</span>} hint={t("rolesHint")}>
          <div className="grid gap-2 sm:grid-cols-2">
            {roles.data.map((role) => (
              <Checkbox
                key={role.name}
                label={roleName(role.name)}
                checked={selected.includes(role.name)}
                onChange={(e) =>
                  setSelected((list) => (e.target.checked ? [...list, role.name] : list.filter((r) => r !== role.name)))
                }
              />
            ))}
          </div>
        </CheckboxGroup>
      )}
      {err?.code === "STALE_VERSION" ? (
        <StaleNotice onReload={onReload} />
      ) : save.error ? (
        <Notice tone="danger">{describe(save.error)}</Notice>
      ) : null}
      <Button variant="secondary" className="self-start" disabled={!changed} onClick={() => setConfirming(true)}>
        {t("saveRoles")}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("rolesConfirmTitle", { name: user.name })}
        description={t("rolesConfirmBody")}
        confirmLabel={t("saveRoles")}
        pending={save.isPending}
        onConfirm={() => save.mutate()}
      >
        <ul className="flex flex-col gap-1 text-sm">
          {added.map((r) => (
            <li key={`+${r}`} className="text-success-700">
              {t("roleAdded", { role: roleName(r) })}
            </li>
          ))}
          {removed.map((r) => (
            <li key={`-${r}`} className="text-danger-700">
              {t("roleRemoved", { role: roleName(r) })}
            </li>
          ))}
          {selected.length === 0 && <li className="font-medium text-warning-700">{t("noRolesWarning")}</li>}
        </ul>
      </ConfirmDialog>
    </section>
  );
}

const REASON_MAX = 500;

function StatusSection({ user }: { user: StaffUser }) {
  const t = useTranslations("admin.users");
  const describe = useAdminErrorMessage();
  const toast = useToast();
  const applyUser = useApplyUser();
  const { me } = useAdminSession();
  const [dialog, setDialog] = useState<"suspend" | "activate" | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const suspended = user.status === "suspended";
  const locked = isLocked(user);
  const self = user.id === me.id;

  const change = useMutation({
    mutationFn: (action: "suspend" | "activate") =>
      action === "suspend" ? suspendStaffUser(user.id, reason.trim()) : activateStaffUser(user.id, reason.trim()),
    onSuccess: (updated, action) => {
      applyUser(updated);
      toast.success(action === "suspend" ? t("suspended") : t("activated"));
      close();
    },
  });

  const open = (action: "suspend" | "activate") => {
    change.reset();
    setReason("");
    setReasonError(null);
    setDialog(action);
  };
  function close() {
    setDialog(null);
  }

  const confirm = () => {
    const trimmed = reason.trim();
    if (dialog === "suspend" && trimmed === "") {
      setReasonError(t("reasonRequired"));
      return;
    }
    if (trimmed.length > REASON_MAX) {
      setReasonError(t("reasonLength"));
      return;
    }
    if (dialog) change.mutate(dialog);
  };

  return (
    <section aria-labelledby={`status-${user.id}`} className="flex flex-col gap-3 border-t border-line pt-5">
      <h3 id={`status-${user.id}`} className="text-base font-bold text-ink-900">
        {t("statusTitle")}
      </h3>
      {suspended || locked ? (
        <>
          <p className="text-sm/6 text-ink-600">{suspended ? t("suspendedBody") : t("lockedBody")}</p>
          <Button variant="secondary" className="self-start" onClick={() => open("activate")} icon={<UserCheck aria-hidden className="size-4" />}>
            {suspended ? t("activate") : t("unlock")}
          </Button>
        </>
      ) : self ? (
        <p className="text-sm/6 text-ink-600">{t("cannotSuspendSelf")}</p>
      ) : (
        <>
          <p className="text-sm/6 text-ink-600">{t("suspendIntro")}</p>
          <Button variant="danger" className="self-start" onClick={() => open("suspend")} icon={<ShieldOff aria-hidden className="size-4" />}>
            {t("suspend")}
          </Button>
        </>
      )}

      <ConfirmDialog
        open={dialog !== null}
        onOpenChange={(o) => !o && close()}
        title={dialog === "suspend" ? t("suspendTitle", { name: user.name }) : t("activateTitle", { name: user.name })}
        description={dialog === "suspend" ? t("suspendBody") : t("activateBody")}
        confirmLabel={dialog === "suspend" ? t("suspend") : suspended ? t("activate") : t("unlock")}
        tone={dialog === "suspend" ? "danger" : "primary"}
        pending={change.isPending}
        onConfirm={confirm}
      >
        <TextArea
          label={dialog === "suspend" ? t("reason") : t("reasonOptional")}
          required={dialog === "suspend"}
          rows={3}
          maxLength={REASON_MAX}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setReasonError(null);
          }}
          error={reasonError}
        />
        {change.error && <Notice tone="danger">{describe(change.error)}</Notice>}
      </ConfirmDialog>
    </section>
  );
}
