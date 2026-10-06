import * as SecureStore from "expo-secure-store";
import { chunkedSecretStorage } from "@recall/api-client";

/** Auth session in the iOS Keychain (device-local, available after first unlock), split into small entries. */
const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

// SecureStore keys allow only [A-Za-z0-9._-]; the auth library's keys contain ':' etc.
const safe = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "_");

export const authStorage = chunkedSecretStorage({
  get: (key) => SecureStore.getItemAsync(safe(key), options),
  set: (key, value) => SecureStore.setItemAsync(safe(key), value, options),
  remove: (key) => SecureStore.deleteItemAsync(safe(key), options),
});
