import type { PrivacyType, StaffVerification } from "./types";

/*
 * Form checks of A07 (contracts A4a §3, A4b §3): the API says 422 for everything here, but the dialogs say so first, in
 * their own words. Lengths count characters of the trimmed text, like Laravel's rules.
 */

export const REASON_MIN = 3;
export const REASON_MAX = 500;
export const NOTE_MAX = 2000;
export const VERIFICATION_NOTE_MIN = 10;
export const VERIFICATION_NOTE_MAX = 500;
export const OTP_CODE_MAX = 10;

export type FormError = "required" | "tooShort" | "tooLong";

const length = (value: string) => Array.from(value.trim()).length;

/** A block, unblock, opt-out or cancel reason: 3 to 500 characters. */
export function checkReason(raw: string): FormError | null {
  const n = length(raw);
  if (n === 0) return "required";
  if (n < REASON_MIN) return "tooShort";
  return n > REASON_MAX ? "tooLong" : null;
}

/** An internal note: 1 to 2000 characters. */
export function checkNote(raw: string): FormError | null {
  const n = length(raw);
  if (n === 0) return "required";
  return n > NOTE_MAX ? "tooLong" : null;
}

export type PrivacyRequestInput = { type: PrivacyType; verification: StaffVerification; note: string; code: string };
export type PrivacyRequestBody = { type: PrivacyType; verification: StaffVerification; verification_note?: string; otp_code?: string };
export type PrivacyRequestBuild = { ok: true; body: PrivacyRequestBody } | { ok: false; field: "note" | "code"; error: FormError };

/**
 * The body of a staff-filed request (P5-C50). A call to the registered number is proved by the code the caller reads back;
 * a visit or a letter by the reference of the document that proved who she is (10 to 500 characters).
 */
export function buildPrivacyRequest(input: PrivacyRequestInput): PrivacyRequestBuild {
  if (input.verification === "registered_phone_call") {
    const code = input.code.trim();
    if (code === "") return { ok: false, field: "code", error: "required" };
    if (code.length > OTP_CODE_MAX) return { ok: false, field: "code", error: "tooLong" };
    return { ok: true, body: { type: input.type, verification: input.verification, otp_code: code } };
  }
  const n = length(input.note);
  if (n === 0) return { ok: false, field: "note", error: "required" };
  if (n < VERIFICATION_NOTE_MIN) return { ok: false, field: "note", error: "tooShort" };
  if (n > VERIFICATION_NOTE_MAX) return { ok: false, field: "note", error: "tooLong" };
  return { ok: true, body: { type: input.type, verification: input.verification, verification_note: input.note.trim() } };
}

/** Thrown inside a mutation when the form is not valid, so the dialog shows the field's message and nothing is sent. */
export class FormProblem<F extends string = string> extends Error {
  constructor(
    readonly field: F,
    readonly error: FormError,
  ) {
    super(`${field}: ${error}`);
  }
}
