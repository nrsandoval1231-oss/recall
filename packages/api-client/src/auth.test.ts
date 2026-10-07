import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({
  auth: {
    signInWithOtp: vi.fn(),
    signUp: vi.fn(),
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
});
