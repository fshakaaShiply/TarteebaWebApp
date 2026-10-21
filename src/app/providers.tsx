"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/** 4xx answers (unauthenticated, forbidden, validation, not found) will not change on retry. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  const status = error && typeof error === "object" && "status" in error ? (error as { status: unknown }).status : null;
  if (typeof status === "number" && status >= 400 && status < 500) return false;
  return failureCount < 1;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: shouldRetry, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
