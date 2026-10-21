"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, ShieldCheck, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, Card, Notice, PageHeader, StatusBadge, TextField, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { confirmTwoFactor, disableTwoFactor, startTwoFactor } from "@/lib/admin/endpoints";
import { useAdminErrorMessage } from "@/lib/admin/errors";
import { adminKeys } from "@/lib/admin/keys";
import { safeAdminNext } from "@/lib/admin/nav";
import { useAdminSession } from "@/lib/admin/session";
import type { StaffMe, TwoFactorSetup } from "@/lib/admin/types";
import { QrCode } from "./QrCode";

/*
 * A01 account security (spec §4.7, §13.2, P1-10). Enrolment: password → POST /admin/me/two-factor → scan the QR code
 * (or type the secret) → confirm with a 6-digit code. Users whose role does not require it can turn it off again
 * with their password and a current code. Wrong passwords count towards the sign-in lockout.
 */

const CODE = /^\d{6}$/;

export function TwoFactorScreen({ next }: { next: string | null }) {
  const t = useTranslations("admin.twoFactor");
  const { me, setupRequired } = useAdminSession();

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {setupRequired && (
        <Notice tone="warning" title={t("requiredTitle")}>
          {t("requiredBody")}
        </Notice>
      )}
      <div className="max-w-2xl">
        {me.two_factor_enabled ? <EnabledPanel /> : <EnrolPanel next={next} required={setupRequired} />}
      </div>
    </>
  );
}

function useApplyMe() {
  const queryClient = useQueryClient();
  return (me: StaffMe) => queryClient.setQueryData(adminKeys.me(), me);
}

function EnrolPanel({ next, required }: { next: string | null; required: boolean }) {
  const t = useTranslations("admin.twoFactor");
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);

  return (
    <Card
      title={t("enrolTitle")}
      actions={<StatusBadge tone="neutral">{t("statusOff")}</StatusBadge>}
    >
      {setup === null ? (
        <PasswordStep onStarted={setSetup} />
      ) : (
        <ConfirmStep setup={setup} next={next} required={required} onRestart={() => setSetup(null)} />
      )}
    </Card>
  );
}

const passwordSchema = z.object({ password: z.string().min(1).max(255) });

function PasswordStep({ onStarted }: { onStarted: (setup: TwoFactorSetup) => void }) {
  const t = useTranslations("admin.twoFactor");
  const describe = useAdminErrorMessage();
  const form = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "" },
  });
  const queryClient = useQueryClient();

  const start = useMutation({
    mutationFn: (password: string) => startTwoFactor(password),
    onSuccess: onStarted,
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "INVALID_PASSWORD") {
        form.setError("password", { type: "server", message: describe(error) });
      } else if (error instanceof AdminApiError && error.code === "TWO_FACTOR_ALREADY_ENABLED") {
        void queryClient.invalidateQueries({ queryKey: adminKeys.me() });
      }
    },
  });

  const showError = start.error && !(start.error instanceof AdminApiError && start.error.code === "INVALID_PASSWORD");

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(({ password }) => start.mutate(password))}
      className="flex flex-col gap-4"
    >
      <p className="text-sm/6 text-ink-600">{t("enrolIntro")}</p>
      <TextField
        label={t("password")}
        type="password"
        autoComplete="current-password"
        error={form.formState.errors.password && (form.formState.errors.password.message || t("passwordRequired"))}
        {...form.register("password")}
      />
      {showError && <Notice tone="danger">{describe(start.error)}</Notice>}
      <Button type="submit" loading={start.isPending} className="self-start">
        {t("continue")}
      </Button>
    </form>
  );
}

const codeSchema = z.object({ code: z.string().regex(CODE) });

function ConfirmStep({
  setup,
  next,
  required,
  onRestart,
}: {
  setup: TwoFactorSetup;
  next: string | null;
  required: boolean;
  onRestart: () => void;
}) {
  const t = useTranslations("admin.twoFactor");
  const describe = useAdminErrorMessage();
  const toast = useToast();
  const router = useRouter();
  const applyMe = useApplyMe();
  const [copied, setCopied] = useState(false);
  const form = useForm<z.infer<typeof codeSchema>>({ resolver: zodResolver(codeSchema), defaultValues: { code: "" } });

  const confirm = useMutation({
    mutationFn: (code: string) => confirmTwoFactor(code),
    onSuccess: (me) => {
      applyMe(me);
      toast.success(t("enabledToast"));
      const target = safeAdminNext(next);
      if (required || target) router.replace(target ?? "/admin");
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "TWO_FACTOR_INVALID") {
        form.setError("code", { type: "server", message: t("codeInvalid") });
      } else if (error instanceof AdminApiError && error.code === "TWO_FACTOR_NOT_STARTED") {
        onRestart();
      }
    },
  });

  const grouped = setup.secret.replace(/(.{4})/g, "$1 ").trim();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the secret stays visible for manual entry.
    }
  };

  const showError = confirm.error && !(confirm.error instanceof AdminApiError && confirm.error.code === "TWO_FACTOR_INVALID");

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex list-decimal flex-col gap-1 ps-5 text-sm/6 text-ink-900">
        <li>{t("step1")}</li>
        <li>{t("step2")}</li>
        <li>{t("step3")}</li>
      </ol>
      <div className="flex flex-wrap items-center gap-5">
        <QrCode value={setup.otpauth_url} label={t("qrLabel")} />
        <div className="flex min-w-0 flex-col gap-2">
          <span className="text-sm font-medium text-ink-600">{t("secretLabel")}</span>
          <code dir="ltr" className="rounded-sm bg-neutral-100 px-3 py-2 font-latin text-base font-semibold tracking-wider break-all text-ink-900">
            {grouped}
          </code>
          <Button variant="outline" size="sm" onClick={copy} icon={<Copy aria-hidden className="size-4" />} className="self-start">
            {copied ? t("copied") : t("copy")}
          </Button>
          <span role="status" className="sr-only">
            {copied ? t("copied") : ""}
          </span>
        </div>
      </div>
      <form
        noValidate
        onSubmit={form.handleSubmit(({ code }) => confirm.mutate(code))}
        className="flex flex-col gap-4"
      >
        <TextField
          label={t("code")}
          dir="ltr"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          maxLength={6}
          className="max-w-48 text-start font-latin text-base font-semibold tracking-[4px]"
          error={form.formState.errors.code && (form.formState.errors.code.message || t("codeFormat"))}
          {...form.register("code")}
        />
        {showError && <Notice tone="danger">{describe(confirm.error)}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={confirm.isPending}>
            {t("confirm")}
          </Button>
          <Button variant="ghost" onClick={onRestart} disabled={confirm.isPending}>
            {t("restart")}
          </Button>
        </div>
      </form>
    </div>
  );
}

const disableSchema = z.object({ password: z.string().min(1).max(255), code: z.string().regex(CODE) });

function EnabledPanel() {
  const t = useTranslations("admin.twoFactor");
  const describe = useAdminErrorMessage();
  const toast = useToast();
  const applyMe = useApplyMe();
  const [open, setOpen] = useState(false);
  const form = useForm<z.infer<typeof disableSchema>>({
    resolver: zodResolver(disableSchema),
    defaultValues: { password: "", code: "" },
  });

  const disable = useMutation({
    mutationFn: ({ password, code }: z.infer<typeof disableSchema>) => disableTwoFactor(password, code),
    onSuccess: (me) => {
      applyMe(me);
      toast.success(t("disabledToast"));
    },
  });

  return (
    <Card title={t("enabledTitle")} actions={<StatusBadge tone="success">{t("statusOn")}</StatusBadge>}>
      <div className="flex items-start gap-3">
        <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success-700" strokeWidth={1.75} />
        <p className="text-sm/6 text-ink-600">{t("enabledBody")}</p>
      </div>
      {!open ? (
        <Button
          variant="outline"
          className="self-start"
          icon={<ShieldOff aria-hidden className="size-4" />}
          onClick={() => setOpen(true)}
        >
          {t("disable")}
        </Button>
      ) : (
        <form
          noValidate
          onSubmit={form.handleSubmit((values) => disable.mutate(values))}
          className="flex flex-col gap-4 rounded-md border border-line p-4"
        >
          <p className="text-sm/6 text-ink-600">{t("disableIntro")}</p>
          <TextField
            label={t("password")}
            type="password"
            autoComplete="current-password"
            error={form.formState.errors.password && t("passwordRequired")}
            {...form.register("password")}
          />
          <TextField
            label={t("code")}
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            maxLength={6}
            className="max-w-48 text-start font-latin text-base font-semibold tracking-[4px]"
            error={form.formState.errors.code && t("codeFormat")}
            {...form.register("code")}
          />
          {disable.error && <Notice tone="danger">{describe(disable.error)}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" loading={disable.isPending}>
              {t("disableConfirm")}
            </Button>
            <Button
              variant="ghost"
              disabled={disable.isPending}
              onClick={() => {
                setOpen(false);
                form.reset();
                disable.reset();
              }}
            >
              {t("cancel")}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
