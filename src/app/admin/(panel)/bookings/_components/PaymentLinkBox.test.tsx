import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { PaymentLinkBox } from "./PaymentLinkBox";

const box = (customerName: string | null, customerLocale: "ar" | "en" = "en") => (
  <PaymentLinkBox
    link="https://pay.example.test/checkout/abc"
    expiresAt={null}
    phone="+971501234567"
    customerName={customerName}
    customerLocale={customerLocale}
    reference="TRB-NEW001"
    serviceDate="2026-10-24"
  />
);

function whatsappText(): string {
  const href = screen.getByRole("link", { name: /Open WhatsApp/ }).getAttribute("href")!;
  return decodeURIComponent(href.split("text=")[1]);
}

describe("payment link WhatsApp message", () => {
  it("greets a customer without a name with no empty gap (the name is optional)", () => {
    renderWithProviders(box(null));
    const text = whatsappText();
    expect(text.startsWith("Hello, here is the payment link")).toBe(true);
    expect(text).toContain("مرحبًا، هذا رابط الدفع");
    expect(text).not.toMatch(/Hello ,|مرحبًا ،/);
  });

  it("treats a blank name like no name", () => {
    renderWithProviders(box("   ", "ar"));
    expect(whatsappText().startsWith("مرحبًا، هذا رابط الدفع")).toBe(true);
  });

  it("greets a named customer by name, in their language first", () => {
    renderWithProviders(box("Sara", "ar"));
    const text = whatsappText();
    expect(text.startsWith("مرحبًا Sara، هذا رابط الدفع")).toBe(true);
    expect(text).toContain("Hello Sara, here is the payment link");
  });
});
