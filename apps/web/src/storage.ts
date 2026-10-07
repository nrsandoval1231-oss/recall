import type { CaptureManifest, ManifestPage } from "@recall/api-client";

export interface Draft { id: string; scope: string; manifest: CaptureManifest; files: Record<string, Blob>; savedAt: string }
const DB_NAME = "recall-web";
const STORE = "capture-drafts";
export const MAX_LOCAL_CAPTURE_BYTES = 25 * 1024 * 1024;
/** Test-only seam used to prove transaction aborts never acknowledge a draft. */
export const storageTestHooks: { afterPut?: (transaction: IDBTransaction) => void } = {};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local capture storage."));
  });
}

export async function saveDraft(draft: Draft): Promise<void> {
  const totalBytes = Object.values(draft.files).reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_LOCAL_CAPTURE_BYTES) throw new Error("This original is larger than Recall's 25 MB limit.");
  const db = await openDb();
  try { await new Promise<void>((resolve, reject) => { const transaction = db.transaction(STORE, "readwrite"); transaction.objectStore(STORE).put(draft); storageTestHooks.afterPut?.(transaction); transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error ?? new Error("Local capture was not durably saved.")); transaction.onerror = () => reject(transaction.error ?? new Error("Local capture could not be saved.")); }); } finally { db.close(); }
}

export async function listDrafts(scope: string): Promise<Draft[]> {
  const db = await openDb();
  const rows = await new Promise<Draft[]>((resolve, reject) => { const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll(); request.onsuccess = () => resolve((request.result as Draft[]).filter((draft) => draft.scope === scope)); request.onerror = () => reject(request.error); });
  db.close(); return rows.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function clearDrafts(scope: string): Promise<void> {
  const drafts = await listDrafts(scope); const db = await openDb();
  await new Promise<void>((resolve, reject) => { const transaction = db.transaction(STORE, "readwrite"); for (const draft of drafts) transaction.objectStore(STORE).delete(draft.id); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
  db.close();
}

export async function deleteDraft(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => { const transaction = db.transaction(STORE, "readwrite"); transaction.objectStore(STORE).delete(id); transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error ?? new Error("Local capture could not be removed.")); transaction.onerror = () => reject(transaction.error ?? new Error("Local capture could not be removed.")); });
  db.close();
}

export function draftPage(scope: string, manifest: CaptureManifest, page: ManifestPage, file: Blob): Draft {
  return { id: manifest.client_capture_id, scope, manifest, files: { [page.client_page_id]: file }, savedAt: new Date().toISOString() };
}
