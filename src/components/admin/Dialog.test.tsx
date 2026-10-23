import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { Dialog } from "./Dialog";

/** Radix starts listening for outside pointer-downs one tick after the dialog opens. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A click on the page behind the dialog (a modal sets pointer-events: none there, so the check is off). It goes to a
 * fresh element: user-event reuses an earlier check cached on document.body even with the check off.
 */
async function clickOutside() {
  await tick();
  const outside = document.body.appendChild(document.createElement("div"));
  await userEvent.setup({ pointerEventsCheck: 0 }).click(outside);
  outside.remove();
}

describe("Dialog outside clicks", () => {
  it("closes on a click outside by default", async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <Dialog open onOpenChange={onOpenChange} title="Edit">
        <p>Body</p>
      </Dialog>,
    );
    await clickOutside();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("with closeOnOutsideClick false stays open on a click outside, and still closes with Escape", async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <Dialog open onOpenChange={onOpenChange} title="Refund" closeOnOutsideClick={false}>
        <p>Body</p>
      </Dialog>,
    );
    await clickOutside();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Refund" })).toBeInTheDocument();
    await userEvent.setup().keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
