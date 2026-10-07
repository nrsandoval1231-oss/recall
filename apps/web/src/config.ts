export interface WebConfig { apiBaseUrl: string }

export function readConfig(env: Record<string, string | undefined>): { config: WebConfig } | { missing: string[] } {
  void env;
  return { config: { apiBaseUrl: "/api" } };
}
