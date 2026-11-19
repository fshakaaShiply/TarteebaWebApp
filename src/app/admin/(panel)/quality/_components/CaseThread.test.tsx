import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CaseEvent } from "@/lib/admin/quality/types";
import { attachment, caseDetail } from "@/test/qualityFixtures";
import { renderWithProviders } from "@/test/render";
import { CaseThread } from "./CaseThread";

const event = (type: string, data: Record<string, unknown> = {}, actor: CaseEvent["actor"] = { type: "staff", id: 4, name: "Omar" }): CaseEvent => ({ type, actor, data, created_at: "2026-10-23T13:00:00+00:00" });

async function timeline(events: CaseEvent[], locale: "en" | "ar" = "en") {
  const c = caseDetail({ events });
  renderWithProviders(<CaseThread c={c} onRefreshFiles={vi.fn()} staffName={(id) => (id === 4 ? "Omar" : null)} />, { locale });
  await userEvent.click(screen.getByRole("button", { name: locale === "en" ? `Show the timeline (${events.length})` : `عرض السجل الزمني (${events.length})` }));
  return within(screen.getByRole("list", { name: locale === "en" ? "Timeline of the case" : "السجل الزمني للحالة" }));
}

describe("the case timeline", () => {
  it("words each kind of event, with who did it and when", async () => {
    const list = await timeline([
      event("assigned", { from: null, to: 4 }),
      event("assigned", { from: 4, to: null }),
      event("priority_changed", { from: "medium", to: "urgent" }),
      event("category_changed", { from: "quality", to: "billing" }),
      event("workers_changed", { added: [1, 4], removed: [2] }),
      event("sla_breached", { kind: "first_response", due_at: "2026-10-23T12:00:00+00:00" }, { type: "system", id: null, name: null }),
      event("reopened", { by: "customer", count: 1 }, { type: "customer", id: null, name: "Laila Hassan" }),
      event("compensation_proposed", { type: "refund", amount_fils: 3000 }),
      event("compensation_rejected", { type: "credit", amount_fils: 1000, reason: "no proof" }),
      event("merged", { into: 9, into_reference: "TC-NEW001" }, { type: "system", id: null, name: null }),
      event("rating_received", { overall: 2 }, { type: "system", id: null, name: null }),
    ]);
    expect(list.getByText("Assigned to Omar")).toBeInTheDocument();
    expect(list.getByText("Taken off its assignee")).toBeInTheDocument();
    expect(list.getByText("Priority changed from Medium to Urgent")).toBeInTheDocument();
    expect(list.getByText("Category changed from Cleaning quality to Payment and billing")).toBeInTheDocument();
    expect(list.getByText("Cleaners named: 2 added, 1 removed")).toBeInTheDocument();
    expect(list.getByText("The deadline for the first reply passed")).toBeInTheDocument();
    expect(list.getByText("Case reopened by Customer")).toBeInTheDocument();
    expect(list.getByText("Compensation proposed: Refund AED 30.00")).toBeInTheDocument();
    expect(list.getByText("Compensation rejected: Balance credit AED 10.00 · Reason: no proof")).toBeInTheDocument();
    expect(list.getByText("Merged into TC-NEW001")).toBeInTheDocument();
    expect(list.getByText("The customer rated the visit 2 out of 5")).toBeInTheDocument();
    expect(list.getAllByText(/· Omar$/).length).toBeGreaterThan(0);
    expect(list.getAllByText(/· System$/).length).toBeGreaterThan(0);
  });

  it("shows the code of an event this page does not know, never nothing", async () => {
    const list = await timeline([event("something_new")]);
    expect(list.getByText("something_new")).toBeInTheDocument();
  });

  it("words the timeline in Arabic too", async () => {
    const list = await timeline([event("priority_changed", { from: "medium", to: "urgent" }), event("created", { source: "phone" }, { type: "staff", id: 4, name: "Omar" })], "ar");
    expect(list.getByText("تغيّرت الأولوية من «متوسطة» إلى «عاجلة»")).toBeInTheDocument();
    expect(list.getByText("فُتحت الحالة (مكالمة هاتفية)")).toBeInTheDocument();
  });
});

describe("the conversation", () => {
  it("shows a case's own files under what the customer first wrote, and a rating follow-up as a system line", () => {
    const c = caseDetail({ source: "rating", description: "Rated 2 out of 5, no comment", attachments: [attachment()], messages: [] });
    renderWithProviders(<CaseThread c={c} onRefreshFiles={vi.fn()} />);
    const list = within(screen.getByRole("list", { name: "Messages" }));
    expect(list.getByText("Rated 2 out of 5, no comment")).toBeInTheDocument();
    // A system line is not a message bubble.
    expect(list.queryByRole("article")).toBeNull();
    expect(list.getByRole("link", { name: /Photo 1/ })).toBeInTheDocument();
  });

  it("signs a staff reply with the staff member's name and keeps an internal note apart from public replies", () => {
    renderWithProviders(<CaseThread c={caseDetail()} onRefreshFiles={vi.fn()} />);
    const articles = screen.getAllByRole("article");
    expect(articles.map((a) => within(a).queryByText("Internal note, the customer never sees it") !== null)).toEqual([false, false, true]);
    // The customer's own words come first, then the team's reply signed by name, then the note.
    expect(within(articles[0]).getByText("Laila Hassan")).toBeInTheDocument();
    expect(within(articles[1]).getByText("Omar")).toBeInTheDocument();
  });
});
