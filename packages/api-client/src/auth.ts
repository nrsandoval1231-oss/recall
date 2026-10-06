import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface AuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface AuthConfig {
  supabaseUrl: string;
  /** The PUBLISHABLE (anon) key only. Never a service-role key. */
  supabasePublishableKey: string;
  storage: AuthStorage;
}

/**
 * Sign-in is delegated entirely to the identity provider (Supabase Auth): a one-time email code,
 * no password or token logic of our own. Sessions persist in platform-protected storage.
 */
export function createAuth(config: AuthConfig) {
  const client: SupabaseClient = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      storage: config.storage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return {
    client,
    async requestEmailCode(email: string): Promise<void> {
      const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw new Error(error.message);
    },
    async verifyEmailCode(email: string, code: string): Promise<void> {
      const { error } = await client.auth.verifyOtp({ email, token: code, type: "email" });
      if (error) throw new Error(error.message);
    },
    async signOut(): Promise<void> {
      await client.auth.signOut();
    },
    async getAccessToken(): Promise<string | null> {
      const { data } = await client.auth.getSession();
      return data.session?.access_token ?? null;
    },
    async getUserId(): Promise<string | null> {
      const { data } = await client.auth.getSession();
      return data.session?.user.id ?? null;
    },
    async hasSession(): Promise<boolean> {
      const { data } = await client.auth.getSession();
      return data.session !== null;
    },
    onSignedInChange(callback: (signedIn: boolean) => void): () => void {
      const { data } = client.auth.onAuthStateChange((_event, session) => callback(session !== null));
      return () => data.subscription.unsubscribe();
    },
  };
}

export type RecallAuth = ReturnType<typeof createAuth>;
