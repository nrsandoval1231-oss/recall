import { summarizeFailure, type AskResponse, type Citation, type RecallApiClient } from "@recall/api-client";

export async function askWithPolicy(api: Pick<RecallApiClient, "ask">, question: string): Promise<{ response?: AskResponse; error?: string }> {
  try { return { response: await api.ask(question.trim()) }; }
  catch (failure) {
    const code = summarizeFailure(failure).code;
    return { error: code === "NETWORK" ? "You're offline. Recall did not generate a fresh answer; your captures are unaffected." : "Recall couldn't answer that right now. No fresh answer was generated, and your captures are unaffected." };
  }
}

export function citationTarget(citation: Citation, rows: { serverId: string | null; memoryId: string | null }[]): { serverId: string; sourceId: string | null } {
  const row = rows.find((candidate) => candidate.serverId === citation.capture_id || (candidate.memoryId && candidate.memoryId === citation.memory_id));
  return { serverId: row?.serverId ?? citation.capture_id, sourceId: citation.source_id };
}
