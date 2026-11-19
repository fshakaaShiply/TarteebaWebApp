import type { ReactNode } from "react";

/*
 * Legal text is plain text with three rules (decision P5-C30): a line starting "# " is a heading, a line starting "- " is a
 * bullet, a blank line ends a paragraph. One renderer serves the customer page and the A11 preview, so what staff see is
 * what customers read. No HTML and no Markdown library: every character is rendered as text by React.
 */

export type LegalBlock = { type: "heading"; text: string } | { type: "paragraph"; text: string } | { type: "list"; items: string[] };

export function parseLegalText(source: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length > 0) blocks.push({ type: "list", items: list });
    list = [];
  };
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line === "") {
      flushParagraph();
      flushList();
    } else if (line.startsWith("# ") && line.slice(2).trim() !== "") {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", text: line.slice(2).trim() });
    } else if (line.startsWith("- ") && line.slice(2).trim() !== "") {
      flushParagraph();
      list.push(line.slice(2).trim());
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** The text as React elements; the page's own title is its h1, so headings here are h2. */
export function renderLegalText(source: string): ReactNode {
  return parseLegalText(source).map((block, index) => {
    switch (block.type) {
      case "heading":
        return (
          <h2 key={index} className="mt-6 text-lg/7 font-bold text-ink-900 first:mt-0">
            {block.text}
          </h2>
        );
      case "list":
        return (
          <ul key={index} className="mt-3 list-disc ps-6 text-base/7 text-ink-900">
            {block.items.map((item, i) => (
              <li key={i} className="mt-1">
                {item}
              </li>
            ))}
          </ul>
        );
      case "paragraph":
        return (
          <p key={index} className="mt-3 whitespace-pre-line text-base/7 text-ink-900 first:mt-0">
            {block.text}
          </p>
        );
    }
  });
}
