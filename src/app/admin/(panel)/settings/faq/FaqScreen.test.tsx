import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { faqItem } from "@/test/customerFixtures";
import { renderWithProviders } from "@/test/render";
import { FaqScreen } from "./FaqScreen";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/settings/faq",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

const api = vi.hoisted(() => ({ fetchFaq: vi.fn(), createFaq: vi.fn(), updateFaq: vi.fn(), deleteFaq: vi.fn(), reorderFaq: vi.fn() }));
vi.mock("@/lib/admin/legal/endpoints", () => api);

const STAFF = ["settings.manage"];
const first = faqItem();
const second = faqItem({ id: 2, question: { ar: "هل أختار العاملة؟", en: "Can I choose my cleaner?" }, answer: { ar: "نعطي الأولوية لعاملتك المفضلة.", en: "We give your preferred cleaner priority." }, sort_order: 20, version: 4 });
const third = faqItem({ id: 3, question: { ar: "ما سياسة الإلغاء؟", en: "What is the cancellation policy?" }, answer: { ar: "تظهر الرسوم قبل التأكيد.", en: "Fees are shown first." }, sort_order: 30, is_active: false });
async function paste(field: HTMLElement, text: string) {
  await userEvent.clear(field);
  await userEvent.click(field);
  await userEvent.paste(text);
}
const err = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "api words", details });

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.fetchFaq.mockResolvedValue([first, second, third]);
});

const names = () => within(screen.getByRole("list", { name: "Questions, in the order customers see them" })).getAllByRole("listitem").map((li) => li.querySelector("span.font-bold")?.textContent);

describe("A11 FAQ", () => {
  it("lists the questions in order and marks a hidden one", async () => {
    renderWithProviders(<FaqScreen />, { permissions: STAFF });
    await screen.findByText("When is my booking confirmed?");
    expect(names()).toEqual(["When is my booking confirmed?", "Can I choose my cleaner?", "What is the cancellation policy?"]);
    const hidden = screen.getByText("What is the cancellation policy?").closest("li")!;
    expect(within(hidden).getAllByText("Hidden").length).toBeGreaterThan(0);
    expect(within(hidden).getByRole("switch", { name: "Show question 3 to customers" })).toHaveAttribute("aria-checked", "false");
  });

  it("moves a question one place and sends the whole new order, then shows the answer's order", async () => {
    renderWithProviders(<FaqScreen />, { permissions: STAFF });
    await screen.findByText("When is my booking confirmed?");
    api.reorderFaq.mockResolvedValue([second, first, third]);
    await userEvent.click(screen.getByRole("button", { name: "Move question 2 up" }));
    await waitFor(() => expect(api.reorderFaq).toHaveBeenCalledWith([2, 1, 3]));
    await waitFor(() => expect(names()[0]).toBe("Can I choose my cleaner?"));
    // The ends cannot move further out.
    expect(screen.getByRole("button", { name: "Move question 1 up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move question 3 down" })).toBeDisabled();
  });

  it("reads the list again when the order was refused", async () => {
    renderWithProviders(<FaqScreen />, { permissions: STAFF });
    await screen.findByText("When is my booking confirmed?");
    api.reorderFaq.mockRejectedValue(err(422, "ORDER_INCOMPLETE", { missing: [4], unknown: [] }));
    const before = api.fetchFaq.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Move question 1 down" }));
    expect(await screen.findByText("The list changed meanwhile. Reload it and move the question again.")).toBeInTheDocument();
    await waitFor(() => expect(api.fetchFaq.mock.calls.length).toBeGreaterThan(before));
  });

  it("shows or hides a question for customers with its version as If-Match", async () => {
    renderWithProviders(<FaqScreen />, { permissions: STAFF });
    await screen.findByText("Can I choose my cleaner?");
    api.updateFaq.mockResolvedValue({ ...second, is_active: false });
    await userEvent.click(screen.getByRole("switch", { name: "Show question 2 to customers" }));
    await waitFor(() => expect(api.updateFaq).toHaveBeenCalledWith(2, { is_active: false }, 4));
  });

  it("adds a question in both languages, with the placeholders explained", async () => {
    renderWithProviders(<FaqScreen />, { permissions: STAFF });
    await userEvent.click(await screen.findByRole("button", { name: "Add a question" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Values the answer can hold")).toBeInTheDocument();
    expect(within(dialog).getByText("{{confirmation_sla}}")).toBeInTheDocument();
    expect(within(dialog).getByText("{{refund_estimated_arrival}}")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findAllByText(/Write the (question|answer) in this language\./)).toHaveLength(4);
    expect(api.createFaq).not.toHaveBeenCalled();
    api.createFaq.mockResolvedValue(faqItem({ id: 9 }));
    await userEvent.type(within(dialog).getByLabelText(/Question.*Arabic/), "كم تستغرق المدة؟");
    await userEvent.type(within(dialog).getByLabelText(/Question.*English/), "How long does it take?");
    await paste(within(dialog).getByLabelText(/Answer.*Arabic/), "خلال {{confirmation_sla}}.");
    await paste(within(dialog).getByLabelText(/Answer.*English/), "Within {{confirmation_sla}}.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.createFaq).toHaveBeenCalledWith({
        question: { ar: "كم تستغرق المدة؟", en: "How long does it take?" },
        answer: { ar: "خلال {{confirmation_sla}}.", en: "Within {{confirmation_sla}}." },
        is_active: true,
      }),
    );
    expect(await screen.findByText("Question added")).toBeInTheDocument();
  });

  it("refuses a placeholder the API cannot fill in, before sending, and shows the API's refusal in words", async () => {
    renderWithProviders(<FaqScreen />, { permissions: STAFF });
    await userEvent.click(await screen.findByRole("button", { name: "Edit question 1" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/Question.*English/)).toHaveValue("When is my booking confirmed?");
    const answer = within(dialog).getByLabelText(/Answer.*English/);
    await paste(answer, "Hello {{name}}");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("{{name}} is not a value we can fill in.")).toBeInTheDocument();
    expect(api.updateFaq).not.toHaveBeenCalled();
    // A placeholder that passes the page's check but not the API's (a newer list) is worded from the API's answer.
    await paste(answer, "Within {{confirmation_sla}}");
    api.updateFaq.mockRejectedValue(err(422, "PLACEHOLDER_UNKNOWN", { placeholder: "{{confirmation_sla}}", allowed: [] }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("{{confirmation_sla}} is not a placeholder we can fill in.")).toBeInTheDocument();
    expect(api.updateFaq).toHaveBeenCalledWith(1, expect.objectContaining({ is_active: true }), 1);
  });

  it("deletes a question after a confirmation", async () => {
    renderWithProviders(<FaqScreen />, { permissions: STAFF });
    await userEvent.click(await screen.findByRole("button", { name: "Delete question 3" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("“What is the cancellation policy?” is removed for good.");
    api.deleteFaq.mockResolvedValue(undefined);
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete question" }));
    await waitFor(() => expect(api.deleteFaq).toHaveBeenCalledWith(3));
    expect(await screen.findByText("Question deleted")).toBeInTheDocument();
  });

  it("stops adding at the limit the API sets", async () => {
    api.fetchFaq.mockResolvedValue(Array.from({ length: 100 }, (_, i) => faqItem({ id: i + 1, sort_order: (i + 1) * 10 })));
    renderWithProviders(<FaqScreen />, { permissions: STAFF });
    expect(await screen.findByText("The FAQ is full (100 questions). Remove one to add another.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a question" })).toBeDisabled();
  });

  it("says when there are no questions, shows a failed load with a retry, and denies staff without settings.manage", async () => {
    api.fetchFaq.mockResolvedValue([]);
    const first = renderWithProviders(<FaqScreen />, { permissions: STAFF });
    expect(await screen.findByText("No questions yet")).toBeInTheDocument();
    first.unmount();
    api.fetchFaq.mockRejectedValueOnce(err(500, "SERVER_ERROR"));
    api.fetchFaq.mockResolvedValue([faqItem()]);
    const second = renderWithProviders(<FaqScreen />, { permissions: STAFF });
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("When is my booking confirmed?")).toBeInTheDocument();
    second.unmount();
    api.fetchFaq.mockClear();
    renderWithProviders(<FaqScreen />, { permissions: ["catalog.manage"] });
    expect(screen.getByText(/don.t have access/i)).toBeInTheDocument();
    expect(api.fetchFaq).not.toHaveBeenCalled();
  });

  it("speaks Arabic and shows each question in the page's language", async () => {
    renderWithProviders(<FaqScreen />, { permissions: STAFF, locale: "ar" });
    expect(await screen.findByText("متى يتم تأكيد حجزي؟")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إضافة سؤال" })).toBeInTheDocument();
  });
});
