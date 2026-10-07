// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { copy } from "@recall/design-tokens";
import { SignIn } from "./SignIn";

describe("SignIn", () => {
  it("keeps existing-link entry available after a rate-limited send", async () => {
    const user = userEvent.setup();
    const auth = {
      requestEmailCode: vi.fn().mockRejectedValue(new Error("rate limit exceeded")),
      verifyEmailCode: vi.fn(),
      verifyEmailLink: vi.fn().mockResolvedValue(undefined),
    };
    render(<SignIn auth={auth} />);

    await user.type(screen.getByLabelText("Email"), "owner@example.test");
    await user.click(screen.getByRole("button", { name: copy.requestSignInLink }));
    expect((await screen.findByRole("alert")).textContent).toBe(copy.signInRateLimit);
    expect(auth.requestEmailCode).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: copy.useExistingSignInCredential }));
    const link = "https://supabase.example.test/auth/v1/verify?token=hash&type=magiclink";
    await user.type(screen.getByLabelText(new RegExp(copy.signInCredentialLabel)), link);
    await user.click(screen.getByRole("button", { name: copy.signIn }));

    await waitFor(() => expect(auth.verifyEmailLink).toHaveBeenCalledWith(link));
    expect(auth.requestEmailCode).toHaveBeenCalledTimes(1);
    expect(auth.verifyEmailCode).not.toHaveBeenCalled();
  });
});
