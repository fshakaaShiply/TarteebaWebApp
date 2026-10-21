"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, Checkbox, CheckboxGroup, Dialog, LoadingBlock, Notice, Select, TextField, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { inviteStaffUser } from "@/lib/admin/endpoints";
import { applyFieldErrors, useAdminErrorMessage, useServerFieldMessage } from "@/lib/admin/errors";
import { adminKeys } from "@/lib/admin/keys";
import { useRoleName, useRoles } from "./shared";

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().max(255),
  phone: z.string().trim().max(32),
  locale: z.enum(["ar", "en"]),
  roles: z.array(z.string()).min(1),
});
type Values = z.infer<typeof schema>;

/**
 * A13 invite: the new user gets an email link to choose their own password (P1-12); admins never set passwords.
 */
export function InviteUserDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("admin.users");
  const describe = useAdminErrorMessage();
  const serverMessage = useServerFieldMessage();
  const toast = useToast();
  const queryClient = useQueryClient();
  const roles = useRoles();
  const roleName = useRoleName();
  const formId = useId();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", phone: "", locale: "ar", roles: [] },
  });

  const invite = useMutation({
    mutationFn: (values: Values) => inviteStaffUser({ ...values, phone: values.phone || null }),
    onSuccess: (user) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.staffUsers() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.roles() });
      toast.success(t("invited", { email: user.email }));
      onClose();
    },
    onError: (error) => {
      applyFieldErrors(error, setError, ["name", "email", "phone", "locale", "roles"]);
    },
  });

  const serverError =
    invite.error && !(invite.error instanceof AdminApiError && invite.error.code === "VALIDATION_FAILED") ? invite.error : null;

  const fieldError = (field: keyof Values, fallback: string) => {
    const e = errors[field];
    return e ? (e.type === "server" ? serverMessage(e.message, fallback) : fallback) : undefined;
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("inviteTitle")}
      description={t("inviteBody")}
      dismissible={!invite.isPending}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={invite.isPending}>
            {t("cancel")}
          </Button>
          <Button type="submit" form={formId} loading={invite.isPending}>
            {t("inviteSubmit")}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={handleSubmit((v) => invite.mutate(v))} className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("form.name")}
          required
          autoComplete="off"
          error={fieldError("name", t("form.nameInvalid"))}
          {...register("name")}
        />
        <TextField
          label={t("form.email")}
          required
          type="email"
          dir="ltr"
          autoComplete="off"
          className="text-start font-latin"
          error={fieldError("email", t("form.emailInvalid"))}
          {...register("email")}
        />
        <TextField
          label={t("form.phone")}
          type="tel"
          dir="ltr"
          autoComplete="off"
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
          error={fieldError("locale", t("form.localeInvalid"))}
          {...register("locale")}
        />
        <div className="sm:col-span-2">
          {roles.isPending ? (
            <LoadingBlock lines={3} />
          ) : roles.isError ? (
            <Notice tone="danger">{describe(roles.error)}</Notice>
          ) : (
            <CheckboxGroup legend={t("form.roles")} hint={t("form.rolesHint")} error={fieldError("roles", t("form.rolesRequired"))}>
              <div className="grid gap-2 sm:grid-cols-2">
                {roles.data.map((role) => (
                  <Checkbox key={role.name} label={roleName(role.name)} value={role.name} {...register("roles")} />
                ))}
              </div>
            </CheckboxGroup>
          )}
        </div>
        {serverError && (
          <Notice tone="danger" className="sm:col-span-2">
            {describe(serverError)}
          </Notice>
        )}
      </form>
    </Dialog>
  );
}
