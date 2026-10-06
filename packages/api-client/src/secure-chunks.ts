/**
 * OS credential stores cap value size (iOS SecureStore warns above 2 KB; Windows Credential
 * Manager blobs are limited to ~2.5 KB) but auth sessions are larger. Split a value across
 * several protected entries. The chunk count is stored last, so a torn write reads as "absent",
 * never as a corrupt session.
 */
export interface SecretBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export function chunkedSecretStorage(backend: SecretBackend, chunkSize = 1500) {
  const countKey = (key: string) => `${key}.n`;
  const chunkKey = (key: string, i: number) => `${key}.${i}`;

  const remove = async (key: string): Promise<void> => {
    const count = Number((await backend.get(countKey(key))) ?? 0);
    await backend.remove(countKey(key));
    for (let i = 0; i < count; i++) await backend.remove(chunkKey(key, i));
  };

  return {
    async getItem(key: string): Promise<string | null> {
      const count = Number((await backend.get(countKey(key))) ?? 0);
      if (!Number.isInteger(count) || count <= 0) return null;
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const part = await backend.get(chunkKey(key, i));
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join("");
    },
    async setItem(key: string, value: string): Promise<void> {
      await remove(key);
      const chunks = value.match(new RegExp(`[\\s\\S]{1,${chunkSize}}`, "g")) ?? [];
      for (let i = 0; i < chunks.length; i++) await backend.set(chunkKey(key, i), chunks[i] as string);
      await backend.set(countKey(key), String(chunks.length));
    },
    removeItem: remove,
  };
}
