"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const schema = z.object({
  email: z.email(),
  password: z.string().min(1),
  otp: z.union([z.literal(""), z.string().regex(/^\d{6}$/)]),
});

type Values = z.infer<typeof schema>;

const inputClass =
  "h-[46px] rounded-sm border border-line-strong bg-surface px-3 text-[15px] text-ink-900 aria-invalid:border-danger-700";

export function LoginForm() {
  const t = useTranslations("admin.login");
  const [notice, setNotice] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "", otp: "" } });

  // Staff authentication (POST /api/v1/admin/auth/login, 2FA, lockout) is built in Phase 1.
  const onSubmit = handleSubmit(async () => {
    setNotice(t("notAvailable"));
  });

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {t("email")}
        <input
          dir="ltr"
          type="email"
          autoComplete="username"
          aria-invalid={!!errors.email}
          className={`${inputClass} font-latin`}
          {...register("email")}
        />
        {errors.email && <span className="text-xs text-danger-700">{t("errors.email")}</span>}
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {t("password")}
        <input
          type="password"
          autoComplete="current-password"
          aria-invalid={!!errors.password}
          className={inputClass}
          {...register("password")}
        />
        {errors.password && <span className="text-xs text-danger-700">{t("errors.password")}</span>}
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {t("otp")}
        <input
          dir="ltr"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          maxLength={6}
          aria-invalid={!!errors.otp}
          className={`${inputClass} font-latin text-base font-semibold tracking-[4px]`}
          {...register("otp")}
        />
        <span className="text-xs text-ink-600">{errors.otp ? t("errors.otp") : t("otpHint")}</span>
      </label>

      <button
        type="submit"
        disabled={isSubmitting}
        className="h-12 rounded-md bg-petrol-700 text-base font-bold text-white hover:bg-petrol-800 disabled:opacity-60"
      >
        {t("submit")}
      </button>

      <a href="/admin/login" className="text-sm font-bold">
        {t("forgot")}
      </a>

      {notice && (
        <p role="status" className="rounded-md bg-apricot-100 px-3.5 py-3 text-[13px]/5 font-medium text-warning-700">
          {notice}
        </p>
      )}
    </form>
  );
}
