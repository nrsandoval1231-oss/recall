import type { LocalVault, VaultMemory } from "../platform/local-vault";
interface Intent { parser: string; organizer: string; publisher: string; revision: number; published: boolean; reviewedFrom?: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function savedIntent(raw: string): Intent {
  const stored: unknown = JSON.parse(raw);
  if (!stored || typeof stored !== "object" || !("parser" in stored) || !("organizer" in stored) || !("publisher" in stored) || !("revision" in stored) || !("published" in stored) || typeof stored.parser !== "string" || !uuid.test(stored.parser) || typeof stored.organizer !== "string" || !uuid.test(stored.organizer) || typeof stored.publisher !== "string" || !uuid.test(stored.publisher) || !Number.isSafeInteger(stored.revision) || Number(stored.revision) < 1 || typeof stored.published !== "boolean" || ("reviewedFrom" in stored && (typeof stored.reviewedFrom !== "string" || !uuid.test(stored.reviewedFrom) || stored.reviewedFrom === stored.organizer))) throw new Error("Saved processing identity is invalid. Original retained; automatic retry stopped.");
  return stored as Intent;
}
function intentKey(selected: { vault_identity: string }, memory: VaultMemory) { return `recall.meeting.v1:${selected.vault_identity}:${memory.id}`; }
export function hasPendingMeeting(selected: { vault_identity: string }, memory: VaultMemory): boolean {
  try { const raw = localStorage.getItem(intentKey(selected, memory)); if (!raw) return false; const intent = savedIntent(raw); return !intent.published && intent.revision === memory.revision && memory.state === "active" && !memory.conflict; } catch { return false; }
}
export async function processMeeting(vault: LocalVault, selected: { vault_id: string; vault_identity: string }, memory: VaultMemory, consent: boolean, onState: (message: string) => void, options?: { reviewRetry: boolean; acknowledgeUncertainty: boolean }): Promise<VaultMemory | null> {
  if (!consent) { onState("Saved locally. Agree before sending this source to Jev and Claude."); return null; }
  if (!vault.parse || !vault.organize || !vault.publish) throw new Error("Open the current native Recall application to organize this memory.");
  if (options?.reviewRetry && !options.acknowledgeUncertainty) throw new Error("Review must acknowledge that prior attempts may have incurred charges.");
  if (options?.reviewRetry && (!vault.reviewedOrganize || !vault.reviewOrganization)) throw new Error("Open the current native application to review an organization retry.");
  const key = intentKey(selected, memory);
  const raw = localStorage.getItem(key);
  let intent: Intent;
  if (raw) {
    intent = savedIntent(raw);
  } else {
    if (options?.reviewRetry) throw new Error("No saved organization attempt to review. Original retained.");
    intent = { parser: crypto.randomUUID(), organizer: crypto.randomUUID(), publisher: crypto.randomUUID(), revision: memory.revision, published: false };
    localStorage.setItem(key, JSON.stringify(intent));
  }
  if (options?.reviewRetry) {
    if (intent.published || memory.revision !== intent.revision || memory.state !== "active" || memory.conflict) throw new Error("Changed or published memory requires review; no new provider operation was created.");
    // Native eligibility is read-only. A refused review must retain the old
    // publication receipt identity, especially after interrupted publication.
    const review = await vault.reviewOrganization!(selected.vault_id, intent.parser, intent.organizer, intent.reviewedFrom);
    if (!uuid.test(review.prior_operation_id) || typeof review.reuse_operation !== "boolean" || (review.reuse_operation ? review.prior_operation_id !== intent.reviewedFrom : review.prior_operation_id !== intent.organizer && review.prior_operation_id !== intent.reviewedFrom)) throw new Error("Native review identity did not match this pending operation.");
    if (!review.reuse_operation) intent = { ...intent, reviewedFrom: review.prior_operation_id, organizer: crypto.randomUUID(), publisher: crypto.randomUUID() };
    localStorage.setItem(key, JSON.stringify(intent));
  }
  if (intent.published || memory.revision !== intent.revision) {
    // A native publish may have succeeded before this renderer recorded completion.
    // Only replay its exact receipt; never send changed source or invent a new operation.
    onState("Checking the previous native publication…");
    const replayed = await vault.publish(selected.vault_id, intent.parser, intent.organizer, intent.publisher);
    if (replayed.id !== memory.id || replayed.revision < intent.revision + 1) throw new Error("Changed memory requires review.");
    intent.published = true; localStorage.setItem(key, JSON.stringify(intent));
    onState("Previous publication recovered. Human corrections preserved.");
    return replayed;
  }
  onState("Checking saved source and Jev processing…");
  const parsed = await vault.parse(selected.vault_id, memory.id, intent.revision, intent.parser, true);
  if (parsed.memory_id !== memory.id || parsed.expected_revision !== intent.revision || parsed.operation_id !== intent.parser) throw new Error("Parser result did not match this memory.");
  if (parsed.state !== "parsed") { onState(parsed.message); return null; }
  onState("Claude is organizing source-linked memory…");
  try {
    if (intent.reviewedFrom) {
      if (!vault.reviewedOrganize) throw new Error("Open the current native application to resume this reviewed operation.");
      // Browser metadata is only an identity hint. Ordinary resume can use an
      // existing matching native audit but can never create a new one.
      await vault.reviewedOrganize(selected.vault_id, intent.parser, intent.reviewedFrom, intent.organizer, true, Boolean(options?.reviewRetry && options.acknowledgeUncertainty));
    } else await vault.organize(selected.vault_id, intent.parser, intent.organizer, true);
  } catch (error) { onState("Claude organization stopped. Original retained; previous reservations stay recorded."); throw error; }
  onState("Validating and publishing to your Obsidian vault…");
  const published = await vault.publish(selected.vault_id, intent.parser, intent.organizer, intent.publisher);
  if (published.id !== memory.id || published.revision < intent.revision + 1 || published.state !== "active" || published.conflict) throw new Error("Publication did not match this memory.");
  intent.published = true;
  localStorage.setItem(key, JSON.stringify(intent));
  onState("Organized in Obsidian. Uncertainty and original evidence preserved.");
  return published;
}
