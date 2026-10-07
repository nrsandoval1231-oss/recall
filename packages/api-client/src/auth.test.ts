import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({
  auth: {
    signInWithOtp: vi.fn(),
    signUp: vi.fn(),
    verifyOtp: vi.fn(),
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => supabase),
}));

import { createAuth } from "./auth";

describe("createAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabase.auth.signInWithOtp.mockResolvedValue({ error: null });
    supabase.auth.verifyOtp.mockResolvedValue({ data: { session: { user: { id: "u1" } } }, error: null });
  });

  it("requests an email code without creating a public signup account", async () => {
    const auth = createAuth({
      supabaseUrl: "https://supabase.example.test",
      supabasePublishableKey: "publishable-key",
      storage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
    });

    await auth.requestEmailCode("owner@example.test");

    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "owner@example.test",
      options: { shouldCreateUser: false },
    });
    expect(supabase.auth.signUp).not.toHaveBeenCalled();
  });

  it("verifies a copied Supabase magic link without opening or following it", async () => {
    const auth = createAuth({
      supabaseUrl: "https://supabase.example.test",
      supabasePublishableKey: "publishable-key",
      storage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
    });

    await auth.verifyEmailLink(
      "https://supabase.example.test/auth/v1/verify?token=hash-123&type=magiclink&redirect_to=http%3A%2F%2Flocalhost%3A3000",
    );

    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "hash-123", type: "email" });
  });

  it.each([
    "http://supabase.example.test/auth/v1/verify?token_hash=h&type=magiclink",
    "https://evil.example.test/auth/v1/verify?token_hash=h&type=magiclink",
    "https://supabase.example.test/auth/v1/recover?token_hash=h&type=magiclink",
    "https://user:pass@supabase.example.test/auth/v1/verify?token=h&type=magiclink",
    "https://supabase.example.test/auth/v1/verify?token=h&type=magiclink#fragment",
    "https://supabase.example.test/auth/v1/verify?token=h&token_hash=h&type=magiclink",
    "https://supabase.example.test/auth/v1/verify?token=h&token=h2&type=magiclink",
    "https://supabase.example.test/auth/v1/verify?token_hash=h&type=recovery",
  ])("rejects an untrusted sign-in link: %s", async (link) => {
    const auth = createAuth({
      supabaseUrl: "https://supabase.example.test",
      supabasePublishableKey: "publishable-key",
      storage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
    });

    await expect(auth.verifyEmailLink(link)).rejects.toThrow(/valid Recall sign-in link/);
    expect(supabase.auth.verifyOtp).not.toHaveBeenCalled();
  });
});
