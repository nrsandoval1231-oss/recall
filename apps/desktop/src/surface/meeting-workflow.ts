import type { LocalVault, VaultMemory } from "../platform/local-vault";
interface Intent { parser: string; organizer: string; publisher: string; revision: number; published: boolean }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function processMeeting(vault: LocalVault, selected: { vault_id: string; vault_identity: string }, memory: VaultMemory, consent: boolean, onState: (message: string) => void): Promise<VaultMemory | null> {
  if (!consent) { onState("Saved locally. Agree before sending this source to Jev and Claude."); return null; }
  if (!vault.parse || !vault.organize || !vault.publish) throw new Error("Open the current native Recall application to organize this memory.");
  const key = `recall.meeting.v1:${selected.vault_identity}:${memory.id}`;
  const raw = localStorage.getItem(key);
  let intent: Intent;
  if (raw) {
    const stored: unknown = JSON.parse(raw);
    if (!stored || typeof stored !== "object" || !("parser" in stored) || !("organizer" in stored) || !("publisher" in stored) || !("revision" in stored) || !("published" in stored) || typeof stored.parser !== "string" || !uuid.test(stored.parser) || typeof stored.organizer !== "string" || !uuid.test(stored.organizer) || typeof stored.publisher !== "string" || !uuid.test(stored.publisher) || !Number.isSafeInteger(stored.revision) || Number(stored.revision) < 1 || typeof stored.published !== "boolean") throw new Error("Saved processing identity is invalid. Original retained; automatic retry stopped.");
    intent = stored as Intent;
  } else {
    intent = { parser: crypto.randomUUID(), organizer: crypto.randomUUID(), publisher: crypto.randomUUID(), revision: memory.revision, published: false };
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
  await vault.organize(selected.vault_id, intent.parser, intent.organizer, true);
  onState("Validating and publishing to your Obsidian vault…");
  const published = await vault.publish(selected.vault_id, intent.parser, intent.organizer, intent.publisher);
  if (published.id !== memory.id || published.revision < intent.revision + 1 || published.state !== "active" || published.conflict) throw new Error("Publication did not match this memory.");
  intent.published = true;
  localStorage.setItem(key, JSON.stringify(intent));
  onState("Organized in Obsidian. Uncertainty and original evidence preserved.");
  return published;
}
