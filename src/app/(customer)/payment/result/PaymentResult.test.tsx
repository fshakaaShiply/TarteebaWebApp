import { render, screen, within } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { readPublicConfig } from "@/lib/server/publicConfig";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import { PaymentResult, paymentReference } from "./PaymentResult";

const tAr = createTranslator({ locale: "ar", messages: ar, namespace: "paymentResult" }) as unknown as (key: string) => string;
const tEn = createTranslator({ locale: "en", messages: en, namespace: "paymentResult" }) as unknown as (key: string) => string;

describe("payment result page (after paying a manual-booking link)", () => {
  it("speaks both languages and never claims the payment went through", () => {
    render(<PaymentResult ar={tAr} en={tEn} reference={paymentReference("01m5mpqyvzne8y1y180r9y84v6")} support={null} />);
    const arabic = screen.getByRole("heading", { name: "شكرًا لك" }).closest("section")!;
    const english = screen.getByRole("heading", { name: "Thank you" }).closest("section")!;
    expect(arabic).toHaveAttribute("dir", "rtl");
    expect(arabic).toHaveAttribute("lang", "ar");
    expect(english).toHaveAttribute("dir", "ltr");

    expect(english).toHaveTextContent(
      "If the payment went through, your request is now with our team for confirmation. You can follow it in the Tarteeba app.",
    );
    expect(arabic).toHaveTextContent("إذا اكتملت عملية الدفع، فطلبك الآن لدى فريقنا بانتظار التأكيد");
    // No success claim, whatever the URL's status says.
    const all = document.body.textContent ?? "";
    expect(all).not.toMatch(/success|confirmed|was paid|has been paid|تم الدفع|تم تأكيد/i);
    expect(within(english).getByText("01m5mpqyvzne8y1y180r9y84v6")).toBeInTheDocument();
    // Without published contacts, help points to the app.
    expect(english).toHaveTextContent("Contact us from the Help page in the Tarteeba app.");
  });

  it("lists the support contacts the API publishes", () => {
    const config = readPublicConfig({ data: { support: { phone: "+97140000000", whatsapp: "+971 50 000 0000", email: "help@example.test" } } });
    render(<PaymentResult ar={tAr} en={tEn} reference={null} support={config?.support ?? null} />);
    const english = screen.getByRole("heading", { name: "Thank you" }).closest("section")!;
    expect(within(english).getByRole("link", { name: /\+97140000000/ })).toHaveAttribute("href", "tel:+97140000000");
    expect(within(english).getByRole("link", { name: "Message us on WhatsApp" })).toHaveAttribute("href", "https://wa.me/971500000000");
    expect(within(english).getByRole("link", { name: "help@example.test" })).toHaveAttribute("href", "mailto:help@example.test");
  });

  it("shows a payment reference only when it looks like one", () => {
    expect(paymentReference("01m5mpqyvzne8y1y180r9y84v6")).toBe("01m5mpqyvzne8y1y180r9y84v6");
    expect(paymentReference("<script>")).toBeNull();
    expect(paymentReference(["01m5mpqyvzne8y1y180r9y84v6"])).toBeNull();
    expect(readPublicConfig({ data: { support: { phone: " ", whatsapp: null } } })?.support).toEqual({ phone: null, whatsapp: null, email: null });
    expect(readPublicConfig("oops")).toBeNull();
  });
});
