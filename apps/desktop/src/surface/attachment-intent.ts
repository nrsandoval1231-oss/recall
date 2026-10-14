interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export function attachmentIntent(
  store: Store,
  identity: string,
  memoryId: string,
  revision: number,
) {
  const key = `recall.attachment.v1:${identity}:${memoryId}`;
  const raw = store.getItem(key);
  const intent: { operation: string; revision: number } = raw
    ? JSON.parse(raw)
    : { operation: crypto.randomUUID(), revision };
  if (
    !/^[a-f0-9-]{36}$/.test(intent.operation) ||
    !Number.isSafeInteger(intent.revision) ||
    intent.revision < 1
  )
    throw Error("Attachment recovery receipt needs review; it was preserved.");
  store.setItem(key, JSON.stringify(intent));
  return { ...intent, acknowledge: () => store.removeItem(key) };
}

export function clearAttachmentIntent(
  store: Store,
  identity: string,
  memoryId: string,
) {
  store.removeItem(`recall.attachment.v1:${identity}:${memoryId}`);
}
