import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import type { CaseSla } from "@/lib/admin/quality/types";
import { SlaChip } from "./SlaChip";

const sla = (over: Partial<CaseSla> = {}): CaseSla => ({ state: "on_track", kind: "first_response", due_at: "2026-10-23T19:00:00+00:00", remaining_minutes: 180, ...over });

describe("SlaChip", () => {
  afterEach(() => vi.useRealTimers());

  it("says how long is left in short words and spells the unit out for a screen reader", () => {
    renderWithProviders(<SlaChip sla={sla()} />);
    expect(screen.getByText("3 h left")).toBeInTheDocument();
    expect(screen.getByText("3 hours left")).toHaveClass("sr-only");
    expect(screen.getByTitle("Deadline for the first reply")).toBeInTheDocument();
  });

  it("says it in Arabic with the same short unit", () => {
    renderWithProviders(<SlaChip sla={sla()} />, { locale: "ar" });
    expect(screen.getByText("متبقي 3 س")).toBeInTheDocument();
    expect(screen.getByText("متبقي 3 ساعات")).toBeInTheDocument();
  });

  it("shows an overdue case in the danger tone", () => {
    renderWithProviders(<SlaChip sla={sla({ state: "breached", due_at: "2026-10-23T14:00:00+00:00", remaining_minutes: -120 })} />);
    const chip = screen.getByText("2 h overdue");
    expect(chip.closest("span.inline-flex")).toHaveClass("text-danger-700");
    expect(screen.getByText("2 hours overdue")).toHaveClass("sr-only");
  });

  it("counts down with its own clock between two reads", async () => {
    vi.useFakeTimers();
    renderWithProviders(<SlaChip sla={sla({ due_at: "2026-10-23T16:50:00+00:00", remaining_minutes: 50 })} />);
    expect(screen.getByText("50 min left")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60_000);
    });
    expect(screen.getByText("20 min left")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60_000);
    });
    expect(screen.getByText("10 min overdue")).toBeInTheDocument();
  });

  it("shows paused and no deadline without a time", () => {
    const { unmount } = renderWithProviders(<SlaChip sla={sla({ state: "paused", due_at: null, remaining_minutes: null })} />);
    expect(screen.getAllByText("Paused").length).toBeGreaterThan(0);
    unmount();
    renderWithProviders(<SlaChip sla={sla({ state: "none", kind: null, due_at: null, remaining_minutes: null })} />);
    expect(screen.getByText("No deadline")).toHaveClass("sr-only");
    expect(screen.getByText("—")).toHaveAttribute("aria-hidden", "true");
  });
});
