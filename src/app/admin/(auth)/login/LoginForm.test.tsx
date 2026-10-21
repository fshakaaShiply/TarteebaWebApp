import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { StaffMe } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { LoginForm } from "./LoginForm";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace,
    push: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const login = vi.fn();
vi.mock("@/lib/admin/endpoints", () => ({
  login: (...args: unknown[]) => login(...args),
}));

const me: StaffMe = {
  id: 1,
  name: "Lina",
  email: "lina@example.test",
  locale: "ar",
  roles: ["booking_coordinator"],
  permissions: ["bookings.view"],
  two_factor_enabled: true,
  two_factor_setup_required: false,
};

const apiError = (
  status: number,
  code: string,
  details: Record<string, unknown> = {},
) => new AdminApiError(status, { code, message: `${code} from API`, details });

// Rejects only when called (a pre-made rejected promise would count as unhandled until the form awaits it).
const failWith = (error: unknown) => async () => {
  throw error;
};

async function fillCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "lina@example.test");
  await user.type(screen.getByLabelText("Password"), "correct horse");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("LoginForm", () => {
  beforeEach(() => {
    replace.mockReset();
    login.mockReset();
  });

  it("asks for the 6-digit code after TWO_FACTOR_REQUIRED and resubmits the same credentials with it", async () => {
    const user = userEvent.setup();
    login
      .mockImplementationOnce(failWith(apiError(422, "TWO_FACTOR_REQUIRED")))
      .mockResolvedValueOnce(me);
    renderWithProviders(<LoginForm next="/admin/users?page=2" reason={null} />);

    expect(screen.queryByLabelText("Two-factor code")).not.toBeInTheDocument();
    await fillCredentials(user);

    const code = await screen.findByLabelText("Two-factor code");
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();

    // A wrong format never reaches the API.
    await user.type(code, "12a");
    await user.click(
      screen.getByRole("button", { name: "Verify and sign in" }),
    );
    expect(await screen.findByText("The code is 6 digits")).toBeInTheDocument();
    expect(login).toHaveBeenCalledTimes(1);

    await user.clear(code);
    await user.type(code, "123456");
    await user.click(
      screen.getByRole("button", { name: "Verify and sign in" }),
    );

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/admin/users?page=2"),
    );
    expect(login).toHaveBeenNthCalledWith(1, {
      email: "lina@example.test",
      password: "correct horse",
      code: undefined,
    });
    expect(login).toHaveBeenNthCalledWith(2, {
      email: "lina@example.test",
      password: "correct horse",
      code: "123456",
    });
  });

  it("shows a wrong code on the code field", async () => {
    const user = userEvent.setup();
    login
      .mockImplementationOnce(failWith(apiError(422, "TWO_FACTOR_REQUIRED")))
      .mockImplementationOnce(failWith(apiError(422, "TWO_FACTOR_INVALID")));
    renderWithProviders(<LoginForm next={null} reason={null} />);

    await fillCredentials(user);
    await user.type(await screen.findByLabelText("Two-factor code"), "000000");
    await user.click(
      screen.getByRole("button", { name: "Verify and sign in" }),
    );

    expect(
      await screen.findByText(/This code is incorrect or has expired/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Two-factor code")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("shows the lockout in minutes from retry_after_seconds", async () => {
    const user = userEvent.setup();
    login.mockImplementationOnce(
      failWith(apiError(423, "ACCOUNT_LOCKED", { retry_after_seconds: 840 })),
    );
    renderWithProviders(<LoginForm next={null} reason={null} />);

    await fillCredentials(user);

    expect(
      await screen.findByText(
        "Too many failed attempts. Sign-in is locked for 14 minutes.",
      ),
    ).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows invalid credentials and rate limiting as alerts", async () => {
    const user = userEvent.setup();
    login
      .mockImplementationOnce(failWith(apiError(422, "INVALID_CREDENTIALS")))
      .mockImplementationOnce(
        failWith(apiError(429, "RATE_LIMITED", { retry_after_seconds: 30 })),
      );
    renderWithProviders(<LoginForm next={null} reason={null} />);

    await fillCredentials(user);
    expect(
      await screen.findByText("The email or password is incorrect."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText(
        "Too many attempts from this device. Try again in 30 seconds.",
      ),
    ).toBeInTheDocument();
  });

  it("puts VALIDATION_FAILED messages on the fields", async () => {
    const user = userEvent.setup();
    login.mockImplementationOnce(
      failWith(
        apiError(422, "VALIDATION_FAILED", {
          fields: { email: ["The email field is odd."] },
        }),
      ),
    );
    renderWithProviders(<LoginForm next={null} reason={null} />);

    await fillCredentials(user);

    expect(
      await screen.findByText("The email field is odd."),
    ).toBeInTheDocument();
  });

  it("sends users who must enrol to the two-factor page and keeps `next`", async () => {
    const user = userEvent.setup();
    login.mockResolvedValueOnce({
      ...me,
      two_factor_enabled: false,
      two_factor_setup_required: true,
    });
    renderWithProviders(<LoginForm next="/admin/settings" reason={null} />);

    await fillCredentials(user);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        `/admin/security/two-factor?next=${encodeURIComponent("/admin/settings")}`,
      ),
    );
  });

  it("ignores an unsafe next and shows the session-ended notice", async () => {
    const user = userEvent.setup();
    login.mockResolvedValueOnce(me);
    renderWithProviders(
      <LoginForm next="//evil.test/admin" reason="expired" />,
    );

    expect(screen.getByText(/Your session ended/)).toBeInTheDocument();
    await fillCredentials(user);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin"));
  });
});
