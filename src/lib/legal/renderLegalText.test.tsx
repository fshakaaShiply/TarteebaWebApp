import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parseLegalText, renderLegalText } from "./renderLegalText";

describe("legal text (P5-C30)", () => {
  it("reads a heading, a bullet list and paragraphs split by blank lines", () => {
    const text = "# Acceptance\nBy using the app you agree.\nThis is the same paragraph.\n\n- One\n- Two\n\nA new paragraph.";
    expect(parseLegalText(text)).toEqual([
      { type: "heading", text: "Acceptance" },
      { type: "paragraph", text: "By using the app you agree.\nThis is the same paragraph." },
      { type: "list", items: ["One", "Two"] },
      { type: "paragraph", text: "A new paragraph." },
    ]);
  });

  it("handles Windows line endings and stray spaces, and ends a list when a paragraph starts", () => {
    expect(parseLegalText("  # Title  \r\n- a\r\ntext after\r\n")).toEqual([
      { type: "heading", text: "Title" },
      { type: "list", items: ["a"] },
      { type: "paragraph", text: "text after" },
    ]);
  });

  it("keeps a bare # or - as text and a heading mark that is not at the start", () => {
    expect(parseLegalText("#\n-\nA # B")).toEqual([{ type: "paragraph", text: "#\n-\nA # B" }]);
    expect(parseLegalText("")).toEqual([]);
  });

  it("renders headings as h2 (the page's title is the h1), bullets as a list, and never as HTML", () => {
    render(<div>{renderLegalText("# Terms\nPlease read <b>this</b> & <script>alert(1)</script>\n\n- First\n- Second")}</div>);
    expect(screen.getByRole("heading", { level: 2, name: "Terms" })).toBeInTheDocument();
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["First", "Second"]);
    // The markup is shown as the text it is: nothing was created from it.
    expect(screen.getByText(/Please read <b>this<\/b>/)).toBeInTheDocument();
    expect(document.querySelector("b, script")).toBeNull();
  });

  it("renders Arabic text as written", () => {
    render(<div>{renderLegalText("# القبول\nباستخدام التطبيق توافق على الشروط.")}</div>);
    expect(screen.getByRole("heading", { name: "القبول" })).toBeInTheDocument();
    expect(screen.getByText("باستخدام التطبيق توافق على الشروط.")).toBeInTheDocument();
  });
});
