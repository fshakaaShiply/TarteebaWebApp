"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, Notice, TextField } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { requestPasswordReset } from "@/lib/admin/endpoints";

const schema = z.object({ email: z.email().max(255) });
type Values = z.infer<typeof schema>;

/**
 * The answer never reveals whether an account exists: every reply from the API (sent, unknown email, throttled)
 * shows the same neutral confirmation. Only a failed connection asks to try again.
 */
export function ForgotPasswordForm() {
  const t = useTranslations("admin.forgot");
  const [sent, setSent] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  const onSubmit = handleSubmit(async ({ email }) => {
    setNetworkError(false);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (error) {
      if (error instanceof AdminApiError && error.code === "NETWORK_ERROR") setNetworkError(true);
      else setSent(true);
    }
  });

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="success" title={t("sentTitle")}>
          {t("sentBody")}
        </Notice>
        <Link href="/admin/login" className="self-start text-sm font-bold">
          {t("backToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <TextField
        label={t("email")}
        type="email"
        dir="ltr"
        autoComplete="username"
        className="font-latin text-start"
        error={errors.email && t("emailInvalid")}
        {...register("email")}
      />
      {networkError && <Notice tone="danger">{t("network")}</Notice>}
      <Button type="submit" size="lg" loading={isSubmitting}>
        {t("submit")}
      </Button>
      <Link href="/admin/login" className="self-start text-sm font-bold">
        {t("backToLogin")}
      </Link>
    </form>
  );
}
