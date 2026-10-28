import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPollDriven, useBackgroundRefresh } from "./backgroundRefresh";

const KEY = ["admin", "thing", 1] as const;

function setup(poll: () => Promise<string>, options: { everyMs?: number; enabled?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  const hook = renderHook((props: { enabled?: boolean }) => useBackgroundRefresh(KEY, poll, { everyMs: options.everyMs ?? 1000, enabled: props.enabled }), {
    wrapper,
    initialProps: { enabled: options.enabled },
  });
  return { queryClient, ...hook };
}

const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("useBackgroundRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    Reflect.deleteProperty(document, "visibilityState");
    vi.useRealTimers();
  });

  it("re-reads a loaded query on the timer and writes the answer into the cache", async () => {
    const poll = vi.fn(async () => "new");
    const { queryClient } = setup(poll);
    queryClient.setQueryData(KEY, "old");
    await tick(1000);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(KEY)).toBe("new");
  });

  it("leaves a query that has nothing loaded yet to its own load", async () => {
    const poll = vi.fn(async () => "new");
    const { queryClient } = setup(poll);
    await tick(3000);
    expect(poll).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(KEY)).toBeUndefined();
  });

  it("skips a tick while a load the user started is running, and drops an answer older than such a load", async () => {
    let answer: (value: string) => void = () => undefined;
    const poll = vi.fn(() => new Promise<string>((resolve) => (answer = resolve)));
    const { queryClient } = setup(poll);
    queryClient.setQueryData(KEY, "old");

    await tick(1000);
    expect(poll).toHaveBeenCalledTimes(1);
    // Meanwhile the member pressed Refresh: that answer is at least as new as the poll's.
    await act(async () => {
      await queryClient.fetchQuery({ queryKey: KEY, queryFn: async () => "from refresh", staleTime: 0 });
    });
    await act(async () => answer("from poll"));
    expect(queryClient.getQueryData(KEY)).toBe("from refresh");

    // A tick while a load is running does not start a poll.
    let finishLoad: (value: string) => void = () => undefined;
    void queryClient.fetchQuery({ queryKey: KEY, queryFn: () => new Promise<string>((resolve) => (finishLoad = resolve)), staleTime: 0 });
    await tick(1000);
    expect(poll).toHaveBeenCalledTimes(1);
    await act(async () => finishLoad("loaded"));
    await tick(1000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("never runs two polls at once", async () => {
    const poll = vi.fn(() => new Promise<string>(() => undefined));
    const { queryClient } = setup(poll);
    queryClient.setQueryData(KEY, "old");
    await tick(5000);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("stops while the tab is hidden and starts again when it is shown", async () => {
    const poll = vi.fn(async () => "new");
    const { queryClient } = setup(poll);
    queryClient.setQueryData(KEY, "old");
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await tick(10_000);
    expect(poll).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await tick(1000);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("keeps the cached data when a poll fails, and polls again on the next tick", async () => {
    const poll = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("new");
    const { queryClient } = setup(poll);
    queryClient.setQueryData(KEY, "old");
    await tick(1000);
    expect(queryClient.getQueryData(KEY)).toBe("old");
    expect(queryClient.getQueryState(KEY)?.status).toBe("success");
    await tick(1000);
    expect(queryClient.getQueryData(KEY)).toBe("new");
  });

  it("marks the reads a changing poll sets off as passive until the user acts", async () => {
    const poll = vi.fn(async () => "team 1,4");
    const { queryClient } = setup(poll);
    queryClient.setQueryData(KEY, "team 1,4");
    // The same answer changes nothing: nothing is marked.
    await tick(1000);
    expect(isPollDriven(queryClient)).toBe(false);

    queryClient.setQueryData(KEY, "nobody");
    await tick(1000);
    expect(isPollDriven(queryClient)).toBe(true);
    // Another client (another page, another test) is not affected.
    expect(isPollDriven(new QueryClient())).toBe(false);

    const userActs = [() => document.body.dispatchEvent(new MouseEvent("click", { bubbles: true })), () => document.dispatchEvent(new KeyboardEvent("keydown"))];
    for (const userAct of userActs) {
      queryClient.setQueryData(KEY, "nobody");
      await tick(1000);
      expect(isPollDriven(queryClient)).toBe(true);
      userAct();
      expect(isPollDriven(queryClient)).toBe(false);
    }
  });

  it("does nothing while disabled, and stops on unmount", async () => {
    const poll = vi.fn(async () => "new");
    const { queryClient, rerender, unmount } = setup(poll, { enabled: false });
    queryClient.setQueryData(KEY, "old");
    await tick(3000);
    expect(poll).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await tick(1000);
    expect(poll).toHaveBeenCalledTimes(1);
    unmount();
    await tick(3000);
    expect(poll).toHaveBeenCalledTimes(1);
  });
});
