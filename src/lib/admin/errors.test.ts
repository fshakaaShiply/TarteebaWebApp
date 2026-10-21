import { describe, expect, it } from "vitest";
import { messageInLocale } from "./errors";

describe("API field messages in the UI language", () => {
  it("keeps an Arabic message on Arabic screens and an English one on English screens", () => {
    expect(messageInLocale("يجب أن تكون المدة من مضاعفات 15.", "ar")).toBe("يجب أن تكون المدة من مضاعفات 15.");
    expect(messageInLocale("The duration must be a multiple of 15.", "en")).toBe("The duration must be a multiple of 15.");
    // Arabic copy may quote a code or attribute in Latin letters.
    expect(messageInLocale("الرمز SOFA_CLEAN مستخدم من قبل.", "ar")).toBe("الرمز SOFA_CLEAN مستخدم من قبل.");
  });

  it("drops a message in the other language (Laravel's English fallback with raw attribute names)", () => {
    expect(messageInLocale("The service.duration minutes field must be a multiple of 15.", "ar")).toBeNull();
    expect(messageInLocale("يجب أن تكون المدة من مضاعفات 15.", "en")).toBeNull();
    expect(messageInLocale("15", "ar")).toBeNull();
    expect(messageInLocale("  ", "en")).toBeNull();
    expect(messageInLocale(undefined, "en")).toBeNull();
  });
});
