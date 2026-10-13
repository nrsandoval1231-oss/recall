import { expect, it } from "vitest";
import { attachmentIntent } from "./attachment-intent";
it("resumes exact attachment operation across restart even if native write advanced the memory", () => {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
  const first = attachmentIntent(store, "library", "memory", 1);
  const retry = attachmentIntent(store, "library", "memory", 2);
  expect(retry.operation).toBe(first.operation);
  expect(retry.revision).toBe(1);
  retry.acknowledge();
  expect(attachmentIntent(store, "library", "memory", 2).operation).not.toBe(
    first.operation,
  );
  expect(
    attachmentIntent(store, "other-library", "memory", 1).operation,
  ).not.toBe(first.operation);
});
