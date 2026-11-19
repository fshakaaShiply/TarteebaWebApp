import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { ThreadBubble } from "./ThreadBubble";

const inList = (ui: React.ReactElement) => renderWithProviders(<ol>{ui}</ol>);

describe("ThreadBubble", () => {
  it("names the author and the time, and keeps the customer's line breaks as text", () => {
    inList(
      <ThreadBubble side="customer" author="Laila" time="23 Oct 12:00">
        {"First line\n<b>not markup</b>"}
      </ThreadBubble>,
    );
    expect(screen.getByRole("article", { name: "Message from Laila, 23 Oct 12:00" })).toBeInTheDocument();
    const body = screen.getByText(/First line/);
    expect(body).toHaveClass("whitespace-pre-wrap");
    expect(body.textContent).toContain("<b>not markup</b>");
    expect(body.querySelector("b")).toBeNull();
  });

  it("says in words that an internal note is never shown to the customer", () => {
    inList(
      <ThreadBubble side="team" author="Omar" time="13:30" internal>
        Supervisor checked
      </ThreadBubble>,
    );
    expect(screen.getByText("Internal note, the customer never sees it")).toBeInTheDocument();
  });

  it("marks a resolution and shows a system line as plain centred text", () => {
    inList(
      <>
        <ThreadBubble side="team" author="Omar" time="14:00" resolution>
          We refunded half.
        </ThreadBubble>
        <ThreadBubble side="system" author="System" time="14:05">
          The customer rated the visit 2 out of 5
        </ThreadBubble>
      </>,
    );
    expect(screen.getByText("Resolution")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("The customer rated the visit 2 out of 5")).toBeInTheDocument();
  });

  it("puts the team's replies at the end and the customer's at the start", () => {
    inList(
      <>
        <ThreadBubble side="customer" author="Laila" time="1">
          Hi
        </ThreadBubble>
        <ThreadBubble side="team" author="Omar" time="2">
          Hello
        </ThreadBubble>
      </>,
    );
    const [customer, team] = screen.getAllByRole("listitem");
    expect(customer).toHaveClass("justify-start");
    expect(team).toHaveClass("justify-end");
  });
});
