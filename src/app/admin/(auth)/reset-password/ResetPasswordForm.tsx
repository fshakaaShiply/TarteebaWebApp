"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import clsx from "clsx";
import { Check, Circle } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { ButtonLink, Button, Notice, TextField } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { resetPassword } from "@/lib/admin/endpoints";
import { applyFieldErrors, useAdminErrorMessage, useServerFieldMessage } from "@/lib/admin/errors";
import { newPasswordSchema, passwordChecks, type PasswordRule } from "@/lib/admin/password";

const schema = z.object({ email: z.email().max(255) }).and(newPasswordSchema);
type Values = z.infer<typeof schema>;

const RULES: PasswordRule[] = ["length", "upper", "lower", "number"];

export function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  const t = useTranslations("admin.reset");
  const describe = useAdminErrorMessage();
  const serverMessage = useServerFieldMessage();
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<AdminApiError | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email, password: "", password_confirmation: "" },
  });
  const password = useWatch({ control, name: "password" }) ?? "";
  const checks = passwordChecks(password);

  if (!token) {
    return (
      <Notice tone="danger" title={t("missingTitle")}>
        <span>{t("missingBody")}</span>
        <Link href="/admin/forgot-password" className="font-bold">
          {t("requestNew")}
        </Link>
      </Notice>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="success" title={t("doneTitle")}>
          {t("doneBody")}
        </Notice>
        <ButtonLink href="/admin/login" size="lg">
          {t("signIn")}
        </ButtonLink>
      </div>
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      await resetPassword({ token, ...values });
      setDone(true);
    } catch (error) {
      if (!applyFieldErrors(error, setError, ["email", "password", "password_confirmation"])) {
        setFailure(error instanceof AdminApiError ? error : AdminApiError.network(error));
      }
    }
  });

  const passwordError =
    errors.password && (errors.password.type === "server" ? serverMessage(errors.password.message, t("errors.rules")) : t("errors.rules"));
  const confirmationError =
    errors.password_confirmation &&
    (errors.password_confirmation.type === "server"
      ? serverMessage(errors.password_confirmation.message, t("errors.match"))
      : t("errors.match"));

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <TextField
        label={t("email")}
        type="email"
        dir="ltr"
        autoComplete="username"
        readOnly={email !== ""}
        className="font-latin text-start"
        error={errors.email && (errors.email.type === "server" ? serverMessage(errors.email.message, t("errors.email")) : t("errors.email"))}
        {...register("email")}
      />
      <TextField
        label={t("password")}
        type="password"
        autoComplete="new-password"
        error={passwordError}
        {...register("password")}
      />
      <ul aria-label={t("rulesTitle")} className="flex flex-col gap-1 text-[13px]">
        {RULES.map((rule) => (
          <li key={rule} className={clsx("flex items-center gap-2", checks[rule] ? "text-success-700" : "text-ink-600")}>
            {checks[rule] ? (
              <Check aria-hidden className="size-4" strokeWidth={2} />
            ) : (
              <Circle aria-hidden className="size-4" strokeWidth={1.75} />
            )}
            <span>{t(`rules.${rule}`)}</span>
            <span className="sr-only">{checks[rule] ? t("ruleMet") : t("ruleNotMet")}</span>
          </li>
        ))}
      </ul>
      <TextField
        label={t("confirmation")}
        type="password"
        autoComplete="new-password"
        error={confirmationError}
        {...register("password_confirmation")}
      />

      {failure && (
        <Notice tone="danger">
          <span>{failure.code === "RESET_TOKEN_INVALID" ? t("errors.tokenInvalid") : describe(failure)}</span>
          {failure.code === "RESET_TOKEN_INVALID" && (
            <Link href="/admin/forgot-password" className="font-bold">
              {t("requestNew")}
            </Link>
          )}
        </Notice>
      )}

      <Button type="submit" size="lg" loading={isSubmitting}>
        {t("submit")}
      </Button>
      <Link href="/admin/login" className="self-start text-sm font-bold">
        {t("backToLogin")}
      </Link>
    </form>
  );
}
