import { describe, expect, it } from "vitest";
import { newPasswordSchema, passwordChecks } from "./password";

describe("passwordChecks", () => {
  it("checks length, lower, upper and number", () => {
    expect(passwordChecks("short")).toEqual({ length: false, lower: true, upper: false, number: false });
    expect(passwordChecks("Abcdefghijk1")).toEqual({ length: true, lower: true, upper: true, number: true });
    expect(passwordChecks("ABCDEFGHIJK1")).toMatchObject({ lower: false });
  });
});

describe("newPasswordSchema", () => {
  it("accepts a strong password with a matching confirmation", () => {
    expect(newPasswordSchema.safeParse({ password: "Abcdefghijk1", password_confirmation: "Abcdefghijk1" }).success).toBe(
      true,
    );
  });

  it("reports weak passwords and mismatched confirmations on their fields", () => {
    const result = newPasswordSchema.safeParse({ password: "abcdefghijkl", password_confirmation: "x" });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => [i.path.join("."), i.message])).toEqual([
      ["password", "rules"],
      ["password_confirmation", "match"],
    ]);
  });
});
