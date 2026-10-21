"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useReducer } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, Notice, TextField } from "@/components/admin";
import { login } from "@/lib/admin/endpoints";
import { applyFieldErrors, useServerFieldMessage } from "@/lib/admin/errors";
import { adminKeys } from "@/lib/admin/keys";
import { initialLoginState, loginReducer, type LoginError } from "@/lib/admin/login-machine";
import { TWO_FACTOR_PATH, safeAdminNext } from "@/lib/admin/nav";

const schema = z.object({
  email: z.email().max(255),
  password: z.string().min(1).max(255),
  code: z.string(),
});

type Values = z.infer<typeof schema>;

const CODE = /^\d{6}$/;

/**
 * A01 sign-in: email + password; when the API answers TWO_FACTOR_REQUIRED the 6-digit authenticator code is asked
 * for and the same credentials are sent again with it (spec §13.2, P1-10).
 */
export function LoginForm({ next, reason }: { next: string | null; reason: "expired" | "signed_out" | null }) {
  const t = useTranslations("admin.login");
  const serverMessage = useServerFieldMessage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(loginReducer, initialLoginState);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "", code: "" } });

  const codeStep = state.step === "code";
  const submitting = state.status === "submitting" || state.status === "done";

  const onSubmit = handleSubmit(async (values) => {
    const code = values.code.trim();
    if (codeStep && !CODE.test(code)) {
      setError("code", { type: "format", message: t("errors.otp") });
      return;
    }
    dispatch({ type: "submit" });
    try {
      const me = await login({ email: values.email, password: values.password, code: codeStep ? code : undefined });
      dispatch({ type: "success" });
      queryClient.setQueryData(adminKeys.me(), me);
      const target = safeAdminNext(next);
      if (me.two_factor_setup_required) {
        router.replace(target ? `${TWO_FACTOR_PATH}?next=${encodeURIComponent(target)}` : TWO_FACTOR_PATH);
      } else {
        router.replace(target ?? "/admin");
      }
    } catch (error) {
      dispatch({ type: "failure", error });
      applyFieldErrors(error, setError, ["email", "password", "code"]);
    }
  });

  const back = () => {
    dispatch({ type: "back" });
    setValue("password", "");
    setValue("code", "");
  };

  // Server field messages are shown only when they are in the UI language (same rule as email and password).
  const codeError = errors.code
    ? errors.code.type === "server"
      ? serverMessage(errors.code.message, t("errors.otp"))
      : errors.code.message
    : state.error?.kind === "two_factor_invalid"
      ? t("errors.codeInvalid")
      : undefined;

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {reason === "expired" && <Notice tone="warning">{t("sessionEnded")}</Notice>}
      {reason === "signed_out" && <Notice tone="success">{t("signedOut")}</Notice>}

      {!codeStep ? (
        <>
          <TextField
            label={t("email")}
            type="email"
            dir="ltr"
            autoComplete="username"
            className="font-latin text-start"
            error={errors.email && (errors.email.type === "server" ? serverMessage(errors.email.message, t("errors.email")) : t("errors.email"))}
            {...register("email")}
          />
          <TextField
            label={t("password")}
            type="password"
            autoComplete="current-password"
            error={
              errors.password && (errors.password.type === "server" ? serverMessage(errors.password.message, t("errors.password")) : t("errors.password"))
            }
            {...register("password")}
          />
        </>
      ) : (
        <>
          <Notice tone="info" role="status">
            <span>{t("codeIntro")}</span>
            <span dir="ltr" className="text-start font-latin">
              {getValues("email")}
            </span>
          </Notice>
          <TextField
            label={t("otp")}
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            maxLength={6}
            autoFocus
            hint={t("otpHint")}
            error={codeError}
            className="text-start font-latin text-base font-semibold tracking-[4px]"
            {...register("code")}
          />
        </>
      )}

      <LoginErrorNotice error={state.error} />

      <Button type="submit" size="lg" loading={submitting}>
        {codeStep ? t("verify") : t("submit")}
      </Button>

      {codeStep ? (
        <button type="button" onClick={back} className="self-start text-sm font-bold text-petrol-700 hover:text-petrol-800">
          {t("useAnotherAccount")}
        </button>
      ) : (
        <Link href="/admin/forgot-password" className="self-start text-sm font-bold">
          {t("forgot")}
        </Link>
      )}
    </form>
  );
}

function LoginErrorNotice({ error }: { error: LoginError | null }) {
  const t = useTranslations("admin.login");
  if (!error) return null;
  switch (error.kind) {
    case "invalid_credentials":
      return <Notice tone="danger">{t("errors.invalidCredentials")}</Notice>;
    case "locked":
      return <Notice tone="danger">{t("errors.locked", { minutes: error.minutes })}</Notice>;
    case "rate_limited":
      return <Notice tone="danger">{t("errors.rateLimited", { seconds: error.seconds })}</Notice>;
    case "network":
      return <Notice tone="danger">{t("errors.network")}</Notice>;
    case "server":
      return <Notice tone="danger">{error.message || t("errors.generic")}</Notice>;
    default:
      // Field-level errors (wrong code, validation) are shown on the fields.
      return null;
  }
}
