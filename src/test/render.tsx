import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import { ToastProvider } from "@/components/admin";
import { hasAnyPermission } from "@/lib/admin/nav";
import { AdminSessionProvider, type AdminSession } from "@/lib/admin/session";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";

/** A signed-in staff session holding `permissions` (for screens behind RequirePermission). */
export function testSession(permissions: readonly string[]): AdminSession {
  return {
    me: {
      id: 1,
      name: "Test Admin",
      email: "admin@example.test",
      locale: "en",
      roles: ["system_admin"],
      permissions: [...permissions],
      two_factor_enabled: true,
      two_factor_setup_required: false,
    },
    can: (permission) => permissions.includes(permission),
    canAny: (wanted) => hasAnyPermission([...permissions], wanted),
    setupRequired: false,
    logout: async () => undefined,
  };
}

/**
 * Renders with the providers every admin screen expects: messages (en by default), React Query and toasts.
 * `permissions` also wraps the UI in a signed-in admin session (useAdminSession / RequirePermission).
 */
export function renderWithProviders(
  ui: ReactElement,
  { locale = "en", permissions, ...options }: { locale?: "ar" | "en"; permissions?: readonly string[] } & RenderOptions = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    const content = permissions ? <AdminSessionProvider session={testSession(permissions)}>{children}</AdminSessionProvider> : children;
    return (
      <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : en} timeZone="Asia/Dubai">
        <QueryClientProvider client={queryClient}>
          <ToastProvider>{content}</ToastProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  }
  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}
