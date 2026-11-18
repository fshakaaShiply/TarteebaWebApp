import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { renderWithProviders } from "@/test/render";
import { SignedFileLink } from "./SignedFileLink";

describe("SignedFileLink", () => {
  afterEach(() => vi.useRealTimers());

  it("asks for the link on click, offers it and moves focus to it", async () => {
    const load = vi.fn().mockResolvedValue({ url: "https://files.example/signed?sig=abc", expires_at: "2026-10-23T16:15:00+00:00", file_name: "visa.pdf" });
    renderWithProviders(<SignedFileLink load={load} label="View document" subject="Residence visa of Maria" />);
    const user = userEvent.setup();
    // Nothing is requested until the click: no link is made for a page nobody opens.
    expect(load).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "View document: Residence visa of Maria" }));
    const link = await screen.findByRole("link", { name: "Open file: Residence visa of Maria" });
    expect(load).toHaveBeenCalledTimes(1);
    expect(link).toHaveAttribute("href", "https://files.example/signed?sig=abc");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(link).not.toHaveAttribute("download");
    await waitFor(() => expect(link).toHaveFocus());
    expect(screen.getByText(/Link valid until/)).toBeInTheDocument();
  });

  it("offers a download with the file's name when asked to", async () => {
    const load = vi.fn().mockResolvedValue({ url: "https://files.example/x", expires_at: "2026-10-23T16:15:00+00:00", file_name: "statement.csv" });
    renderWithProviders(<SignedFileLink load={load} label="Get file" download />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Get file" }));
    const link = await screen.findByRole("link", { name: "Download file" });
    expect(link).toHaveAttribute("download", "statement.csv");
  });

  it("never stores the link: nothing is written to the browser's storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const load = vi.fn().mockResolvedValue({ url: "https://files.example/secret", expires_at: "2026-10-23T16:15:00+00:00" });
    renderWithProviders(<SignedFileLink load={load} label="View" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "View" }));
    await screen.findByRole("link");
    expect(setItem).not.toHaveBeenCalled();
    expect(JSON.stringify(localStorage)).not.toContain("secret");
    expect(JSON.stringify(sessionStorage)).not.toContain("secret");
    setItem.mockRestore();
  });

  it("asks again once the link has expired, instead of offering a dead one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const load = vi
      .fn()
      .mockResolvedValueOnce({ url: "https://files.example/first", expires_at: new Date(Date.now() + 60_000).toISOString() })
      .mockResolvedValueOnce({ url: "https://files.example/second", expires_at: new Date(Date.now() + 15 * 60_000).toISOString() });
    renderWithProviders(<SignedFileLink load={load} label="View" />);
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    await user.click(screen.getByRole("button", { name: "View" }));
    expect(await screen.findByRole("link")).toHaveAttribute("href", "https://files.example/first");

    await act(async () => {
      vi.advanceTimersByTime(90_000);
    });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("This link has expired. Get a new one to open the file.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Get a new link" }));
    expect(await screen.findByRole("link")).toHaveAttribute("href", "https://files.example/second");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("trusts a link with no expiry for a few minutes only", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const load = vi.fn().mockResolvedValue({ url: "https://files.example/noexp" });
    renderWithProviders(<SignedFileLink load={load} label="View" />);
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    await user.click(screen.getByRole("button", { name: "View" }));
    expect(await screen.findByRole("link")).toBeInTheDocument();
    expect(screen.queryByText(/Link valid until/)).not.toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the API's refusal and lets the person try again", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new AdminApiError(403, { code: "FORBIDDEN", message: "No.", details: {} }))
      .mockResolvedValueOnce({ url: "https://files.example/ok", expires_at: "2026-10-23T16:15:00+00:00" });
    renderWithProviders(<SignedFileLink load={load} label="View" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View" }));
    expect(await screen.findByText(/don't have permission|not allowed|permission/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View" }));
    expect(await screen.findByRole("link")).toBeInTheDocument();
  });

  it("reads in Arabic", async () => {
    const load = vi.fn().mockResolvedValue({ url: "https://files.example/x", expires_at: "2026-10-23T16:15:00+00:00" });
    renderWithProviders(<SignedFileLink load={load} label="عرض الوثيقة" subject="تأشيرة ماريا" />, { locale: "ar" });
    await userEvent.setup().click(screen.getByRole("button", { name: "عرض الوثيقة: تأشيرة ماريا" }));
    expect(await screen.findByRole("link", { name: "فتح الملف: تأشيرة ماريا" })).toBeInTheDocument();
    expect(screen.getByText(/الرابط صالح حتى/)).toBeInTheDocument();
  });
});
