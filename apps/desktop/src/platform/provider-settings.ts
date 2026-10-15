import { invoke } from "@tauri-apps/api/core";

export type ProviderId = "claude" | "jev";

export interface ProviderField {
  name: string;
  /** Non-secret value, or a masked key suffix such as `…abcd`. Never a full key. */
  value: string | null;
  source: "saved" | "environment" | "missing";
}

export interface ProviderView {
  provider: ProviderId;
  fields: ProviderField[];
}

export interface ProviderSettingsApi {
  status(): Promise<ProviderView[]>;
  save(provider: ProviderId, values: Record<string, string>): Promise<void>;
  clear(provider: ProviderId): Promise<void>;
}

/** Keys go into the OS credential store through the desktop process; the webview cannot read them back. */
export function nativeProviderSettings(): ProviderSettingsApi | null {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return null;
  return {
    status: () => invoke<ProviderView[]>("provider_settings_status"),
    save: (provider, values) => invoke<void>("provider_settings_save", { provider, values }),
    clear: (provider) => invoke<void>("provider_settings_clear", { provider }),
  };
}
