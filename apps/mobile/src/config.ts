/** Public client configuration only. The Supabase PUBLISHABLE key is public by design; never put a service-role key here. */
export interface AppConfig {
  apiBaseUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export function readConfig(env: Record<string, string | undefined>): { config: AppConfig } | { missing: string[] } {
  const entries = {
    EXPO_PUBLIC_API_BASE_URL: env.EXPO_PUBLIC_API_BASE_URL,
    EXPO_PUBLIC_SUPABASE_URL: env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
  const missing = Object.entries(entries).filter(([, v]) => !v || v.trim() === "").map(([k]) => k);
  if (missing.length > 0) return { missing };
  return {
    config: {
      apiBaseUrl: entries.EXPO_PUBLIC_API_BASE_URL as string,
      supabaseUrl: entries.EXPO_PUBLIC_SUPABASE_URL as string,
      supabasePublishableKey: entries.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
    },
  };
}

// Metro inlines EXPO_PUBLIC_* only for literal `process.env.NAME` accesses.
export const loadConfig = () =>
  readConfig({
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
