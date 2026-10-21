import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { IconButton } from "./Button";
import { ChipsInput } from "./ChipsInput";
import { Switch } from "./Switch";
import { Tabs } from "./Tabs";

// The `touch-target` utility (src/app/globals.css) gives small controls an invisible 44×44px hit area for tablets.
describe("small controls have a 44px touch target", () => {
  it("chip remove buttons, switches, icon buttons and tabs", () => {
    renderWithProviders(
      <>
        <ChipsInput label="Exceptions" value={["weather_alert"]} onChange={vi.fn()} />
        <Switch label="Active" checked onCheckedChange={vi.fn()} />
        <IconButton label="Remove tier 1">×</IconButton>
        <Tabs id="t" label="Sections" value="a" onValueChange={vi.fn()} items={[{ value: "a", label: "General" }]} />
      </>,
    );
    expect(screen.getByRole("button", { name: "Remove weather_alert" })).toHaveClass("touch-target");
    expect(screen.getByRole("switch", { name: "Active" })).toHaveClass("touch-target");
    expect(screen.getByRole("button", { name: "Remove tier 1" })).toHaveClass("touch-target");
    expect(screen.getByRole("tab", { name: "General" })).toHaveClass("touch-target");
  });
});
