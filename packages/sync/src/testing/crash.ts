import type { LocalFiles } from "../ports";

export class CrashError extends Error {
  constructor() {
    super("simulated crash / force-close");
  }
}

/**
 * Wraps LocalFiles and "kills the process" at the Nth operation: that call and every later call
 * throw CrashError, exactly as if the app had been terminated at that instant.
 */
export function crashingFiles(inner: LocalFiles, crashAtOperation: number): { files: LocalFiles; operations: () => number; crashed: () => boolean } {
  let count = 0;
  let dead = false;
  const files = new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || prop === "absoluteUri") return value;
      return async (...args: unknown[]) => {
        if (dead || ++count >= crashAtOperation) {
          dead = true;
          throw new CrashError();
        }
        return (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
      };
    },
  });
  return { files, operations: () => count, crashed: () => dead };
}
