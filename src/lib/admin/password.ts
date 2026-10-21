import { z } from "zod";

// Staff password rules (ResetPasswordRequest): at least 12 characters with upper- and lower-case letters and a number.
export const PASSWORD_MIN_LENGTH = 12;

export type PasswordRule = "length" | "lower" | "upper" | "number";

export function passwordChecks(password: string): Record<PasswordRule, boolean> {
  return {
    length: password.length >= PASSWORD_MIN_LENGTH,
    lower: /\p{Ll}/u.test(password),
    upper: /\p{Lu}/u.test(password),
    number: /\p{Nd}/u.test(password),
  };
}

export const newPasswordSchema = z
  .object({
    password: z.string().max(255),
    password_confirmation: z.string(),
  })
  .superRefine((value, ctx) => {
    const checks = passwordChecks(value.password);
    if (!Object.values(checks).every(Boolean)) {
      ctx.addIssue({ code: "custom", path: ["password"], message: "rules" });
    }
    if (value.password_confirmation !== value.password) {
      ctx.addIssue({ code: "custom", path: ["password_confirmation"], message: "match" });
    }
  });
