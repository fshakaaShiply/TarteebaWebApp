import { describe, expect, it } from "vitest";
import { AdminApiError } from "./client";
import { initialLoginState, lockoutMinutes, loginReducer, type LoginState } from "./login-machine";

const apiError = (status: number, code: string, details: Record<string, unknown> = {}, message = "msg") =>
  new AdminApiError(status, { code, message, details });

const submitted = (state: LoginState) => loginReducer(state, { type: "submit" });
const failed = (state: LoginState, error: unknown) => loginReducer(submitted(state), { type: "failure", error });

describe("loginReducer", () => {
  it("starts on the credentials step", () => {
    expect(initialLoginState).toEqual({ step: "credentials", status: "idle", error: null });
  });

  it("marks the form as submitting and clears the previous error", () => {
    const withError: LoginState = { step: "credentials", status: "idle", error: { kind: "invalid_credentials" } };
    expect(submitted(withError)).toEqual({ step: "credentials", status: "submitting", error: null });
  });

  it("moves to the code step when the API asks for two-factor", () => {
    expect(failed(initialLoginState, apiError(422, "TWO_FACTOR_REQUIRED"))).toEqual({
      step: "code",
      status: "idle",
      error: null,
    });
  });

  it("stays on the code step with an error for a wrong code", () => {
    const codeStep = failed(initialLoginState, apiError(422, "TWO_FACTOR_REQUIRED"));
    expect(failed(codeStep, apiError(422, "TWO_FACTOR_INVALID"))).toEqual({
      step: "code",
      status: "idle",
      error: { kind: "two_factor_invalid" },
    });
  });

  it("goes back to credentials on INVALID_CREDENTIALS, even from the code step", () => {
    const codeStep = failed(initialLoginState, apiError(422, "TWO_FACTOR_REQUIRED"));
    expect(failed(codeStep, apiError(422, "INVALID_CREDENTIALS"))).toEqual({
      step: "credentials",
      status: "idle",
      error: { kind: "invalid_credentials" },
    });
  });

  it("reports a lockout in whole minutes from retry_after_seconds", () => {
    expect(failed(initialLoginState, apiError(423, "ACCOUNT_LOCKED", { retry_after_seconds: 841 })).error).toEqual({
      kind: "locked",
      minutes: 15,
    });
    expect(failed(initialLoginState, apiError(423, "ACCOUNT_LOCKED", {})).error).toEqual({ kind: "locked", minutes: 1 });
  });

  it("reports rate limiting with seconds", () => {
    expect(failed(initialLoginState, apiError(429, "RATE_LIMITED", { retry_after_seconds: 42 })).error).toEqual({
      kind: "rate_limited",
      seconds: 42,
    });
  });

  it("keeps validation field errors and shows the code step when the code is invalid", () => {
    const state = failed(
      initialLoginState,
      apiError(422, "VALIDATION_FAILED", { fields: { email: ["The email must be valid."] } }),
    );
    expect(state).toEqual({
      step: "credentials",
      status: "idle",
      error: { kind: "validation", fields: { email: ["The email must be valid."] } },
    });
    expect(failed(initialLoginState, apiError(422, "VALIDATION_FAILED", { fields: { code: ["x"] } })).step).toBe("code");
  });

  it("treats non-API failures as network errors and other codes as server messages", () => {
    expect(failed(initialLoginState, new TypeError("Failed to fetch")).error).toEqual({ kind: "network" });
    expect(failed(initialLoginState, AdminApiError.network()).error).toEqual({ kind: "network" });
    expect(failed(initialLoginState, apiError(400, "SESSION_UNAVAILABLE", {}, "Use the web app")).error).toEqual({
      kind: "server",
      message: "Use the web app",
    });
  });

  it("finishes on success and resets on back", () => {
    const codeStep = failed(initialLoginState, apiError(422, "TWO_FACTOR_REQUIRED"));
    expect(loginReducer(submitted(codeStep), { type: "success" })).toEqual({ step: "code", status: "done", error: null });
    expect(loginReducer(codeStep, { type: "back" })).toEqual(initialLoginState);
  });
});

describe("lockoutMinutes", () => {
  it("rounds up to whole minutes, at least one", () => {
    expect(lockoutMinutes(900)).toBe(15);
    expect(lockoutMinutes(61)).toBe(2);
    expect(lockoutMinutes(1)).toBe(1);
    expect(lockoutMinutes(0)).toBe(1);
    expect(lockoutMinutes(null)).toBe(1);
  });
});
