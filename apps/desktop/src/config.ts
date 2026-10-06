export interface DesktopConfig {
  apiBaseUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export function readConfig(env: Record<string, string | undefined>): { config: DesktopConfig } | { missing: string[] } {
  const e = { VITE_API_BASE_URL: env.VITE_API_BASE_URL, VITE_SUPABASE_URL: env.VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: env.VITE_SUPABASE_PUBLISHABLE_KEY };
  const missing = Object.entries(e).filter(([, v]) => !v?.trim()).map(([k]) => k);
  if (missing.length) return { missing };
  return { config: { apiBaseUrl: e.VITE_API_BASE_URL as string, supabaseUrl: e.VITE_SUPABASE_URL as string, supabasePublishableKey: e.VITE_SUPABASE_PUBLISHABLE_KEY as string } };
}
