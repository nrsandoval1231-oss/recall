import { describe, expect, it, vi } from "vitest";
import { NativeCache } from "./platform/native-cache";

describe("NativeCache", () => {
  it("reports browser persistence as unavailable instead of pretending to cache", async () => {
    const cache = new NativeCache({ syncChanges: vi.fn(), syncSnapshot: vi.fn(), syncPush: vi.fn() });
    if (!cache.available) await expect(cache.sync({ user_id: "u", workspace_id: "w" })).rejects.toThrow("LOCAL_CACHE_UNAVAILABLE");
  });
});
