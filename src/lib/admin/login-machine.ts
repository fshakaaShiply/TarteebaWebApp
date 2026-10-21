import { AdminApiError } from "./client";

/*
 * A01 sign-in as a small state machine (spec §13.2, REQ A01):
 *
 *   credentials --submit--> submitting --TWO_FACTOR_REQUIRED--> code step (same email/password + 6-digit code)
 *   code        --submit--> submitting --TWO_FACTOR_INVALID---> code step with an error
 *   any         --INVALID_CREDENTIALS--> credentials step with an error
 *   any         --ACCOUNT_LOCKED (423)--> error with whole minutes from details.retry_after_seconds
 *   any         --RATE_LIMITED (429)---> error with seconds from details.retry_after_seconds
 *   any         --VALIDATION_FAILED----> per-field errors
 *   any         --success--------------> done
 */

export type LoginStep = "credentials" | "code";

export type LoginError =
  | { kind: "invalid_credentials" }
  | { kind: "two_factor_invalid" }
  | { kind: "locked"; minutes: number }
  | { kind: "rate_limited"; seconds: number }
  | { kind: "validation"; fields: Record<string, string[]> }
  | { kind: "network" }
  | { kind: "server"; message: string };

export type LoginState = {
  step: LoginStep;
  status: "idle" | "submitting" | "done";
  error: LoginError | null;
};

export type LoginEvent =
  | { type: "submit" }
  | { type: "success" }
  | { type: "failure"; error: unknown }
  | { type: "back" };

export const initialLoginState: LoginState = { step: "credentials", status: "idle", error: null };

/** Whole minutes left on a lockout, at least 1 (840 s → 14, 841 s → 15). */
export function lockoutMinutes(retryAfterSeconds: number | null | undefined): number {
  if (typeof retryAfterSeconds !== "number" || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) return 1;
  return Math.max(1, Math.ceil(retryAfterSeconds / 60));
}

function failure(state: LoginState, error: unknown): LoginState {
  const idle = { ...state, status: "idle" as const };
  if (!(error instanceof AdminApiError)) return { ...idle, error: { kind: "network" } };

  switch (error.code) {
    case "TWO_FACTOR_REQUIRED":
      return { ...idle, step: "code", error: null };
    case "TWO_FACTOR_INVALID":
      return { ...idle, step: "code", error: { kind: "two_factor_invalid" } };
    case "INVALID_CREDENTIALS":
      return { ...idle, step: "credentials", error: { kind: "invalid_credentials" } };
    case "ACCOUNT_LOCKED":
      return { ...idle, error: { kind: "locked", minutes: lockoutMinutes(error.retryAfterSeconds) } };
    case "RATE_LIMITED":
      return { ...idle, error: { kind: "rate_limited", seconds: Math.max(1, error.retryAfterSeconds ?? 60) } };
    case "VALIDATION_FAILED": {
      const fields = error.fieldErrors;
      return { ...idle, step: fields.code ? "code" : state.step, error: { kind: "validation", fields } };
    }
    case "NETWORK_ERROR":
      return { ...idle, error: { kind: "network" } };
    default:
      return { ...idle, error: { kind: "server", message: error.message } };
  }
}

export function loginReducer(state: LoginState, event: LoginEvent): LoginState {
  switch (event.type) {
    case "submit":
      return { ...state, status: "submitting", error: null };
    case "success":
      return { ...state, status: "done", error: null };
    case "failure":
      return failure(state, event.error);
    case "back":
      return initialLoginState;
  }
}
