import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { readPublicConfig } from "@/lib/server/publicConfig";
import type { FaqEntry, LegalPage, Loaded } from "@/lib/server/legal";
import { renderWithProviders } from "@/test/render";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import { otherLanguageHref } from "./_components/CustomerPageShell";
import { AccountDeletionView } from "./account-deletion/AccountDeletionView";
import { EmailVerifiedView, emailStatus } from "./email-verified/EmailVerifiedView";
import { HelpView } from "./help/HelpView";
import { PolicyView, policyDate } from "./policies/[slug]/PolicyView";
import { PrivacyExportFlow, linkIsUsable } from "./privacy-export/PrivacyExportFlow";

type T = (key: string, values?: Record<string, string | number>) => string;
const tr = (locale: "ar" | "en", namespace: string) => createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: namespace as never }) as unknown as T;

const page: LegalPage = { slug: "terms", version_label: "2026-10", effective_date: "2026-10-01", title: "Terms and conditions", body: "# Acceptance\nBy using the app you agree.\n\n- One\n- Two" };
const ok = <T,>(data: T): Loaded<T> => ({ status: "ok", data });

describe("policies page", () => {
  const view = (lang: "ar" | "en", state: Loaded<LegalPage>) => render(<PolicyView slug="terms" lang={lang} state={state} t={tr(lang, "customerWeb.policies")} common={tr(lang, "customerWeb.common")} />);

  it("shows the title, the version and day, and the text with its headings and bullets", () => {
    view("en", ok(page));
    expect(screen.getByRole("heading", { level: 1, name: "Terms and conditions" })).toBeInTheDocument();
    expect(screen.getByText("Version 2026-10 · 1 October 2026")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Acceptance" })).toBeInTheDocument();
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(2);
  });

  it("speaks Arabic right to left by default, and links the same page in English with ?lang=", () => {
    view("ar", ok({ ...page, title: "الشروط والأحكام", body: "# القبول\nباستخدام التطبيق توافق على الشروط." }));
    const wrapper = screen.getByRole("heading", { level: 1 }).closest("[lang]")!;
    expect(wrapper).toHaveAttribute("lang", "ar");
    expect(wrapper).toHaveAttribute("dir", "rtl");
    expect(screen.getByText(/الإصدار 2026-10/)).toBeInTheDocument();
    const switcher = screen.getByRole("link", { name: "English" });
    expect(switcher).toHaveAttribute("href", "/policies/terms?lang=en");
    expect(switcher).toHaveAttribute("lang", "en");
  });

  it("writes the day a version takes effect without a weekday and with Latin digits", () => {
    expect(policyDate("2026-10-01", "en")).toBe("1 October 2026");
    expect(policyDate("2026-10-01", "ar")).toBe("1 أكتوبر 2026");
    expect(policyDate("not a date", "en")).toBe("not a date");
  });

  it("keeps an English page left to right with a link back to Arabic", () => {
    view("en", ok(page));
    expect(screen.getByRole("heading", { level: 1 }).closest("[lang]")).toHaveAttribute("dir", "ltr");
    expect(screen.getByRole("link", { name: "العربية" })).toHaveAttribute("href", "/policies/terms?lang=ar");
  });

  it("says the page cannot be shown now when the API is unreachable, without inventing a text", () => {
    view("en", { status: "unavailable" });
    expect(screen.getByRole("alert")).toHaveTextContent("This page can't be shown right now");
    expect(screen.queryByText(/Acceptance/)).toBeNull();
  });
});

describe("help page", () => {
  const faq: FaqEntry[] = [
    { id: 1, question: "When is my booking confirmed?", answer: "Our team confirms within 4 working hours." },
    { id: 2, question: "Can I choose my cleaner?", answer: "We give your preferred cleaner priority." },
  ];
  const support = readPublicConfig({ data: { support: { phone: "+97140000000", whatsapp: "+971 50 000 0000", email: "help@example.test" } } })!.support;
  const view = (lang: "ar" | "en", state: Loaded<FaqEntry[]>, contacts: typeof support | null) => render(<HelpView lang={lang} faq={state} support={contacts} t={tr(lang, "customerWeb.help")} common={tr(lang, "customerWeb.common")} />);

  it("lists the FAQ as the API sends it, in order, each question opening its answer", () => {
    view("en", ok(faq), support);
    const items = screen.getAllByRole("listitem").filter((li) => li.querySelector("details"));
    expect(items.map((li) => li.querySelector("summary")?.textContent)).toEqual(["When is my booking confirmed?", "Can I choose my cleaner?"]);
    expect(screen.getByText("Our team confirms within 4 working hours.")).toBeInTheDocument();
  });

  it("links the contacts the API publishes, and only those", () => {
    view("en", ok(faq), support);
    expect(screen.getByRole("link", { name: /\+97140000000/ })).toHaveAttribute("href", "tel:+97140000000");
    expect(screen.getByRole("link", { name: "Message us on WhatsApp" })).toHaveAttribute("href", "https://wa.me/971500000000");
    expect(screen.getByRole("link", { name: "help@example.test" })).toHaveAttribute("href", "mailto:help@example.test");
  });

  it("hides an unset contact, and sends the customer to the app when none is set", () => {
    view("en", ok(faq), { phone: null, whatsapp: null, email: "help@example.test" });
    expect(screen.queryByRole("link", { name: /Call us/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Message us on WhatsApp" })).toBeNull();
    expect(screen.getByRole("link", { name: "help@example.test" })).toBeInTheDocument();
  });

  it("points to the app when no contact is published, says where a support request is made, and links the policies", () => {
    view("en", ok(faq), { phone: null, whatsapp: null, email: null });
    expect(screen.getByText("Contact us from the Help page in the Tarteeba app.")).toBeInTheDocument();
    expect(screen.getByText(/open Help in the app and choose Support request/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Terms and conditions" })).toHaveAttribute("href", "/policies/terms?lang=en");
    view("en", ok(faq), null);
  });

  it("says the questions are missing without breaking the page, in Arabic too", () => {
    view("ar", { status: "unavailable" }, support);
    expect(screen.getByRole("alert")).toHaveTextContent("تعذّر تحميل الأسئلة الآن");
    expect(screen.getByRole("heading", { level: 1, name: "المساعدة" }).closest("[lang]")).toHaveAttribute("dir", "rtl");
  });

  it("says there are no questions yet", () => {
    view("en", ok([]), support);
    expect(screen.getByText("No questions yet.")).toBeInTheDocument();
  });

  it("gives every contact and policy link a 44 px tap height of its own, for the app's WebView", () => {
    view("en", ok(faq), support);
    const links = [
      screen.getByRole("link", { name: /\+97140000000/ }),
      screen.getByRole("link", { name: "Message us on WhatsApp" }),
      screen.getByRole("link", { name: "help@example.test" }),
      ...(["Terms and conditions", "Privacy policy", "Cancellation and refund policy"] as const).map((name) => screen.getByRole("link", { name })),
    ];
    for (const link of links) expect(link, link.textContent ?? "").toHaveClass("inline-flex", "min-h-11", "items-center");
    // Real height rather than an overlay hit area, so stacked links never share one: no touch-target pseudo-element.
    for (const link of links) expect(link).not.toHaveClass("touch-target");
  });
});

describe("account deletion page", () => {
  const support = { phone: "+97140000000", whatsapp: null, email: "help@example.test" };
  const view = (lang: "ar" | "en", graceDays: number | null, contacts: typeof support | null = support, walletEnabled?: boolean) =>
    render(<AccountDeletionView lang={lang} support={contacts} graceDays={graceDays} walletEnabled={walletEnabled} t={tr(lang, "customerWeb.accountDeletion")} common={tr(lang, "customerWeb.common")} />);

  it("says what deletion removes and keeps, the cooling-off in days, and both ways to ask", () => {
    view("en", 7);
    expect(screen.getByRole("heading", { level: 1, name: "Delete your Tarteeba account" })).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "What we remove" }).closest("section")!).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText(/waits 7 days before the deletion is carried out/)).toBeInTheDocument();
    expect(screen.getByText("Open Account, then Delete account.")).toBeInTheDocument();
    expect(screen.getByText(/stay cancelled, even if the deletion is stopped later/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /\+97140000000/ })).toHaveAttribute("href", "tel:+97140000000");
  });

  it("claims no more than deletion erases: invoices keep the printed name and phone, cases stay without her words, no purge is promised", () => {
    view("en", 7);
    const removed = within(screen.getByRole("heading", { name: "What we remove" }).closest("section")!);
    const kept = within(screen.getByRole("heading", { name: "What we keep" }).closest("section")!);
    expect(removed.getByText("Your name, phone number and e-mail on your account")).toBeInTheDocument();
    // Complaints and ratings are kept (scores and outcomes), only her words in them go.
    expect(removed.queryByText(/^Your complaints/)).toBeNull();
    expect(removed.getByText("The words and photos you added to complaints, ratings and requests")).toBeInTheDocument();
    expect(kept.getByText(/Tax invoices and credit notes, which keep your name and phone number as printed/)).toBeInTheDocument();
    expect(kept.getByText("Your complaints and ratings without your words: only their scores and outcomes")).toBeInTheDocument();
    expect(kept.getAllByRole("listitem")).toHaveLength(4);
    expect(kept.getByText("These records are kept for the period the law requires.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/removes your personal data from Tarteeba|kept only for/);
  });

  it("says a balance must be used or given up first only while the balance is switched on", () => {
    view("en", 7);
    expect(screen.queryByText(/If your account has a balance/)).toBeNull();
    cleanup();
    view("en", 7, support, true);
    expect(screen.getByText(/If your account has a balance, use it first or tell our support team that you give it up/)).toBeInTheDocument();
    cleanup();
    view("ar", 7, support, true);
    expect(screen.getByText(/إذا كان في حسابك رصيد/)).toBeInTheDocument();
    expect(screen.getByText("تُحفظ هذه السجلات للمدة التي يفرضها القانون.")).toBeInTheDocument();
  });

  it("does not name a number of days it was not told, and promises no amount", () => {
    view("en", null);
    expect(screen.getByText(/waits a few days/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d+ days|AED|will be refunded|you will receive/i);
  });

  it("agrees the Arabic number of days and reads right to left", () => {
    view("ar", 7);
    expect(screen.getByText(/ينتظر 7 أيام قبل تنفيذ الحذف/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 }).closest("[lang]")).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("link", { name: "English" })).toHaveAttribute("href", "/account-deletion?lang=en");
  });

  it("sends the customer to the app when no contact is published", () => {
    view("en", 7, null);
    expect(screen.getByText("Contact us from the Help page in the Tarteeba app.")).toBeInTheDocument();
  });
});

describe("e-mail verified page", () => {
  it("reads the three states the API's link sends, and anything else as an invalid link", () => {
    expect(emailStatus("verified")).toBe("verified");
    expect(emailStatus("expired")).toBe("expired");
    expect(emailStatus("invalid")).toBe("invalid");
    expect(emailStatus("hacked")).toBe("invalid");
    expect(emailStatus(undefined)).toBe("invalid");
    expect(emailStatus(["verified", "x"])).toBe("verified");
  });

  it.each([
    ["verified", "Your e-mail is confirmed", "تم تأكيد بريدك الإلكتروني"],
    ["expired", "This link has expired", "انتهت صلاحية الرابط"],
    ["invalid", "This link isn't valid", "الرابط غير صالح"],
  ] as const)("says what happened for %s, in both languages", (status, english, arabic) => {
    const { unmount } = render(<EmailVerifiedView lang="en" status={status} t={tr("en", "customerWeb.emailVerified") as never} common={tr("en", "customerWeb.common") as never} />);
    expect(screen.getByRole("heading", { name: english })).toBeInTheDocument();
    unmount();
    render(<EmailVerifiedView lang="ar" status={status} t={tr("ar", "customerWeb.emailVerified") as never} common={tr("ar", "customerWeb.common") as never} />);
    expect(screen.getByRole("heading", { name: arabic })).toBeInTheDocument();
  });

  it("keeps the status when the language is switched, and shows no account data", () => {
    render(<EmailVerifiedView lang="en" status="expired" t={tr("en", "customerWeb.emailVerified") as never} common={tr("en", "customerWeb.common") as never} />);
    expect(screen.getByRole("link", { name: "العربية" })).toHaveAttribute("href", "/email-verified?status=expired&lang=ar");
    expect(document.body.textContent).not.toMatch(/@|\+971/);
  });
});

describe("language links", () => {
  it("toggles ?lang= and keeps the other parameters (a data copy's link carries its signature)", () => {
    expect(otherLanguageHref("/help", "ar")).toBe("/help?lang=en");
    expect(otherLanguageHref("/privacy-export", "en", { request: "R1", expires: "123", signature: "abc", status: undefined })).toBe("/privacy-export?request=R1&expires=123&signature=abc&lang=ar");
    // An incoming lang is replaced, not repeated.
    expect(otherLanguageHref("/x", "ar", { lang: "ar", a: "1" })).toBe("/x?a=1&lang=en");
  });
});

describe("data copy download page", () => {
  const REQUEST = "01JP0000000000000000000021";
  const SIGNATURE = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
  const link = { request: REQUEST, expires: "1790000000", signature: SIGNATURE, status: null } as const;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  /** The line saying where the code went (the page's own status line, not the toast region the test providers add). */
  const codeLine = () => screen.findByText((_, el) => el?.tagName === "P" && el.getAttribute("role") === "status");

  function open(fetcher: ReturnType<typeof vi.fn>, over: Partial<Parameters<typeof PrivacyExportFlow>[0]> = {}, locale: "ar" | "en" = "en") {
    const redirect = vi.fn();
    const view = renderWithProviders(<PrivacyExportFlow lang={locale} {...link} fetcher={fetcher as unknown as typeof fetch} redirect={redirect} {...over} />, { locale });
    return { redirect, ...view };
  }

  it("only takes a link shaped like the API's", () => {
    expect(linkIsUsable(link)).toBe(true);
    expect(linkIsUsable({ ...link, request: "not-a-ulid" })).toBe(false);
    expect(linkIsUsable({ ...link, expires: "tomorrow" })).toBe(false);
    expect(linkIsUsable({ ...link, signature: null })).toBe(false);
    expect(linkIsUsable({ request: null, expires: null, signature: null })).toBe(false);
  });

  it("asks for the code first and posts the link's own proof, without cookies", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ data: { phone_masked: "+971•••••1234", expires_in: 300, resend_in: 30 } }));
    open(fetcher);
    expect(screen.getByRole("heading", { name: "Download your data" })).toBeInTheDocument();
    // Nothing is handed over before the code: there is no download button yet.
    expect(screen.queryByRole("button", { name: "Download my data" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Send me a code" }));
    expect(await codeLine()).toHaveTextContent("We sent a code to +971•••••1234.");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`/backend/api/v1/public/privacy-exports/${REQUEST}/otp`);
    expect(init).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store", body: JSON.stringify({ expires: "1790000000", signature: SIGNATURE }), headers: expect.objectContaining({ "Accept-Language": "en" }) });
    expect(screen.getByRole("button", { name: /Send a new code in \d+ s/ })).toBeDisabled();
  });

  it("downloads with the right code: posts it with the proof and follows the signed URL once, keeping nothing of it", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ data: { phone_masked: "+971•••••1234", expires_in: 300, resend_in: 0 } }))
      .mockResolvedValueOnce(json({ data: { url: "https://files.example.test/signed?sig=abc", expires_at: "2026-11-20T10:15:00+00:00" } }));
    const { redirect } = open(fetcher);
    await userEvent.click(screen.getByRole("button", { name: "Send me a code" }));
    await userEvent.type(await screen.findByLabelText("Code"), " 482913 ");
    await userEvent.click(screen.getByRole("button", { name: "Download my data" }));
    await waitFor(() => expect(redirect).toHaveBeenCalledWith("https://files.example.test/signed?sig=abc"));
    const [url, init] = fetcher.mock.calls[1];
    expect(url).toBe(`/backend/api/v1/public/privacy-exports/${REQUEST}/download`);
    expect(JSON.parse(init.body)).toEqual({ expires: "1790000000", signature: SIGNATURE, code: "482913" });
    expect(await screen.findByText("Your download is starting")).toBeInTheDocument();
    // The URL is nowhere on the page.
    expect(document.body.innerHTML).not.toContain("files.example.test");
  });

  it("says a wrong code is wrong, with the attempts left, and an expired one to ask again", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ data: { phone_masked: "+971•••••1234", expires_in: 300, resend_in: 0 } }))
      .mockResolvedValueOnce(json({ error: { code: "OTP_INVALID", message: "", details: { attempts_left: 2 } } }, 422))
      .mockResolvedValueOnce(json({ error: { code: "OTP_EXPIRED", message: "", details: {} } }, 422));
    const { redirect } = open(fetcher);
    await userEvent.click(screen.getByRole("button", { name: "Send me a code" }));
    await userEvent.type(await screen.findByLabelText("Code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Download my data" }));
    expect(await screen.findByText("That code isn't right. 2 attempts left.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Download my data" }));
    expect(await screen.findByText("That code has expired. Ask for a new one.")).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("stops after too many wrong codes", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ data: { phone_masked: "+971•••••1234", expires_in: 300, resend_in: 0 } }))
      .mockResolvedValueOnce(json({ error: { code: "OTP_LOCKED", message: "", details: {} } }, 429));
    open(fetcher);
    await userEvent.click(screen.getByRole("button", { name: "Send me a code" }));
    await userEvent.type(await screen.findByLabelText("Code"), "111111");
    await userEvent.click(screen.getByRole("button", { name: "Download my data" }));
    expect(await screen.findByText(/Too many wrong attempts/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download my data" })).toBeDisabled();
  });

  it("shows a link the API refused as expired or invalid, and never keeps asking for a code", async () => {
    const expired = vi.fn().mockResolvedValue(json({ error: { code: "EXPORT_EXPIRED", message: "", details: {} } }, 410));
    const first = open(expired);
    await userEvent.click(screen.getByRole("button", { name: "Send me a code" }));
    expect(await screen.findByRole("heading", { name: "This link has expired" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send me a code" })).toBeNull();
    first.unmount();
    const forged = vi.fn().mockResolvedValue(json({ error: { code: "PRIVACY_LINK_INVALID", message: "", details: {} } }, 403));
    open(forged);
    await userEvent.click(screen.getByRole("button", { name: "Send me a code" }));
    expect(await screen.findByRole("heading", { name: "This link isn't valid" })).toBeInTheDocument();
  });

  it("shows the API's own redirect states (?status=expired|invalid) and a link that is missing its proof, without calling the API", () => {
    const fetcher = vi.fn();
    const a = open(fetcher, { status: "expired" });
    expect(screen.getByRole("heading", { name: "This link has expired" })).toBeInTheDocument();
    a.unmount();
    const b = open(fetcher, { status: "invalid" });
    expect(screen.getByRole("heading", { name: "This link isn't valid" })).toBeInTheDocument();
    b.unmount();
    open(fetcher, { signature: null });
    expect(screen.getByRole("heading", { name: "This link isn't valid" })).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("says when the network failed and lets the customer try again", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(json({ data: { phone_masked: "+971•••••1234", expires_in: 300, resend_in: 0 } }));
    open(fetcher);
    await userEvent.click(screen.getByRole("button", { name: "Send me a code" }));
    expect(await screen.findByText("Something went wrong. Check your connection and try again.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send me a code" }));
    expect(await codeLine()).toHaveTextContent("We sent a code to +971•••••1234.");
  });

  it("speaks Arabic", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ data: { phone_masked: "+971•••••1234", expires_in: 300, resend_in: 0 } }));
    open(fetcher, {}, "ar");
    expect(screen.getByRole("heading", { name: "تنزيل بياناتك" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "أرسل لي رمزًا" }));
    expect(await screen.findByText(/أرسلنا رمزًا إلى/)).toBeInTheDocument();
    expect(fetcher.mock.calls[0][1].headers["Accept-Language"]).toBe("ar");
  });

  it("keeps the masked number in one left-to-right run inside the sentence, so the Arabic text cannot reorder it", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ data: { phone_masked: "+971•••••1234", expires_in: 300, resend_in: 0 } }));
    open(fetcher, {}, "ar");
    await userEvent.click(screen.getByRole("button", { name: "أرسل لي رمزًا" }));
    const line = await codeLine();
    expect(line).toHaveTextContent("أرسلنا رمزًا إلى +971•••••1234.");
    const phone = within(line).getByText("+971•••••1234");
    expect(phone.tagName).toBe("BDI");
    expect(phone).toHaveAttribute("dir", "ltr");
  });

  it("names the registered phone in words when the API sent no masked number", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ data: { expires_in: 300, resend_in: 0 } }));
    open(fetcher);
    await userEvent.click(screen.getByRole("button", { name: "Send me a code" }));
    expect(await codeLine()).toHaveTextContent("We sent a code to your registered phone.");
  });
});
