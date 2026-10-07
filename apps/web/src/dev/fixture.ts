/** DEVELOPMENT ONLY. All names, artifacts, dates and claims are fictional.
 * No network API, storage, upload, consent change or export is available here.
 */
import {
  sha256Hex,
  type AskResponse,
  type Citation,
  type CorrectionInput,
  type EntityDetail,
  type EntitySummary,
  type MemoryDetail,
  type ServerCapture,
} from "@recall/api-client";
import type { SurfaceApi } from "../surface/MemorySurface";
import emailUrl from "./assets/september-email.png?url";
// Notebook and site images are generated fictional artifacts, preserved as fixture originals.
import notebookUrl from "./assets/july-notebook.png?url";
import photoUrl from "./assets/august-site.png?url";

const july = "2026-07-18T10:00:00Z",
  august = "2026-08-12T10:00:00Z",
  september = "2026-09-09T09:15:00Z";
const summary = (
  entity_id: string,
  name: string,
  kind: EntitySummary["kind"],
): EntitySummary => ({
  entity_id,
  name,
  canonical_name: name,
  kind,
  version: 1,
  created_at: july,
  updated_at: september,
});
const people = [
  summary("mara", "Mara Chen", "person"),
  summary("alder", "Alder Works", "organization"),
  summary("north-yard", "North yard", "place"),
  summary("brooks", "Brooks Campus", "project"),
];
const seedMemory = (
  id: string,
  title: string,
  text: string,
  date: string,
  transcription: string,
): MemoryDetail => ({
  memory_id: id,
  capture_id: `capture-${id}`,
  revision: 1,
  status: "ready",
  summary: text,
  context_hint: title,
  captured_at: date,
  page_count: 1,
  model_id: "synthetic-fixture",
  created_at: date,
  revised_at: date,
  timezone: "UTC",
  processor_version: "synthetic-1",
  interpretation: {
    summary: text,
    summary_evidence: [{ page_id: `source-${id}`, quote: transcription }],
    pages: [
      {
        page_id: `source-${id}`,
        ordinal: 1,
        transcription,
        legibility: "clear",
      },
    ],
    mentions: [],
    statements: [],
    action_suggestions: [],
    uncertainties: [],
  },
  validation_notes: [],
  labels: {
    transcription: "Synthetic interpretation",
    action_suggestions: "Synthetic suggestions",
  },
  entities: people,
  history: [
    {
      revision: 1,
      origin: "model",
      summary: text,
      changed_at: date,
      reason: "Synthetic initial reading",
    },
  ],
});
const notebook = seedMemory(
  "notebook",
  "The July site walk",
  "Mara Chen walked Brooks Campus with Alder Works. The July plan expected startup in January 2027; a later update supersedes that date.",
  july,
  "Site walk with Mara Chen. Alder Works / North yard. Startup expected: January 2027. Cooling loop — 800 psi? confirm. Mara to send revised plan.",
);
notebook.claims = [
  {
    claim_id: "startup-july",
    memory_id: notebook.memory_id,
    kind: "claim",
    text: "The July plan expected startup in January 2027.",
    epistemic_state: "superseded",
    temporal_text: "July plan; superseded by September update",
    valid_from: july,
    valid_to: september,
    version: 1,
    evidence: [
      { page_id: "source-notebook", quote: "Startup expected: January 2027" },
    ],
  },
  {
    claim_id: "pressure",
    memory_id: notebook.memory_id,
    kind: "claim",
    text: "The cooling loop may require 800 psi. This is unconfirmed.",
    epistemic_state: "uncertain",
    temporal_text: null,
    version: 1,
    evidence: [
      { page_id: "source-notebook", quote: "Cooling loop — 800 psi? confirm" },
    ],
  },
];
notebook.interpretation.uncertainties = [
  {
    kind: "number",
    description:
      "800 psi was written with a question mark. No confirming specification is available.",
    evidence: [{ page_id: "source-notebook", quote: "800 psi?" }],
  },
];
const photo = seedMemory(
  "site",
  "North yard, in August",
  "The August site photograph records the north yard at Brooks Campus. It does not establish commissioning readiness.",
  august,
  "Synthetic photograph of North yard, Brooks Campus — August 12, 2026.",
);
const email = seedMemory(
  "plan",
  "A change in the plan",
  "Mara’s September update moves expected startup to March 2027. The cooling loop pressure remains unconfirmed.",
  september,
  "The expected date is now March 2027. The July notebook recorded January 2027. Cooling loop pressure is still unconfirmed.",
);
email.claims = [
  {
    claim_id: "startup-september",
    memory_id: email.memory_id,
    kind: "claim",
    text: "Startup is now expected in March 2027.",
    epistemic_state: "reported",
    temporal_text: "September 9 update",
    valid_from: september,
    valid_to: null,
    supersedes_claim_id: "startup-july",
    version: 1,
    evidence: [
      { page_id: "source-plan", quote: "The expected date is now March 2027." },
    ],
  },
];
const seeds = [notebook, email, photo];
export function createFixtureApi(scenario = ""): {
  api: SurfaceApi;
  captures: ServerCapture[];
} {
  if (!import.meta.env.DEV)
    throw new Error("Synthetic fixture is development-only.");
  const memories = new Map(seeds.map((m) => [m.memory_id, structuredClone(m)]));
  const urls: Record<string, string> = {
    "source-notebook": notebookUrl,
    "source-site": photoUrl,
    "source-plan": emailUrl,
  };
  const citation = (memory: MemoryDetail, index: number): Citation => ({
    citation_id: `c${index}`,
    memory_id: memory.memory_id,
    memory_revision: memory.revision,
    capture_id: memory.capture_id,
    source_id: memory.interpretation.pages[0]!.page_id,
    page: 1,
    quote: memory.interpretation.pages[0]!.transcription,
    captured_at: memory.captured_at,
    epistemic_state: memory.memory_id === "notebook" ? "uncertain" : "reported",
    kind: "transcription",
  });
  const delay = () =>
    new Promise<void>((resolve) =>
      setTimeout(resolve, scenario === "slow" ? 2500 : 220),
    );
  const api: SurfaceApi = {
    async ask(question, options = {}) {
      await delay();
      const date = options.as_of ?? "9999";
      const eligible = (options.as_of ? seeds : [...memories.values()]).filter(
        (m) => m.created_at <= date,
      );
      const noMatch =
        !/brooks|campus|mara|alder|yard|startup|cooling/i.test(question) ||
        scenario === "empty" ||
        !eligible.length;
      const citations = noMatch ? [] : eligible.map(citation);
      const latest =
        eligible.find((m) => m.memory_id === "plan") ??
        eligible.find((m) => m.memory_id === "notebook");
      const latestClaim = latest?.claims?.find((c) =>
        c.claim_id.startsWith("startup"),
      );
      const text =
        date < september
          ? "The July site walk with Mara Chen recorded expected startup in January 2027. The cooling loop pressure was uncertain."
          : "Brooks Campus connects the site walks with Mara Chen at Alder Works. Startup is now expected in March 2027, changed from the July plan. The cooling loop pressure remains unconfirmed.";
      const understood = latestClaim
        ? `Brooks Campus connects the site walks with Mara Chen at Alder Works. ${latestClaim.text} The cooling loop pressure remains unconfirmed.`
        : text;
      const status = noMatch
        ? "insufficient_evidence"
        : scenario === "unavailable"
          ? "unavailable"
          : scenario === "ambiguous"
            ? "ambiguous"
            : "answered";
      return {
        question,
        status,
        answer: status === "unavailable" || noMatch ? null : understood,
        sentences:
          status === "unavailable" || noMatch
            ? []
            : [
                {
                  text: understood,
                  citation_ids: citations.map((c) => c.citation_id),
                },
              ],
        citations: status === "unavailable" ? [] : citations,
        sources: citations,
        limitations: noMatch
          ? [
              "No supporting evidence exists in this synthetic world. Try asking about Brooks Campus.",
            ]
          : [
              "800 psi is a question in the source, not a confirmed specification.",
              ...(scenario === "unavailable"
                ? [
                    "Synthetic unavailable-AI scenario: originals remain accessible.",
                  ]
                : scenario === "ambiguous"
                  ? [
                      "Synthetic ambiguity scenario: compare the original plans before acting.",
                    ]
                  : []),
            ],
        reason: noMatch ? "NO_EVIDENCE" : null,
        index_as_of: september,
        mode: status === "unavailable" ? "sources_only" : "online_grounded",
        temporal_mode: options.as_of ? "before" : "current",
      } satisfies AskResponse;
    },
    async getMemory(id) {
      await delay();
      const memory = memories.get(id);
      if (!memory) throw new Error("Synthetic memory not found.");
      return structuredClone(memory);
    },
    async getEntity(id) {
      await delay();
      const entity = people.find((e) => e.entity_id === id);
      if (!entity) throw new Error("Synthetic context not found.");
      return {
        ...entity,
        memories: [...memories.values()],
        timeline: [...memories.values()]
          .flatMap((memory) =>
            (memory.claims ?? []).map((claim) => ({
              claim_id: claim.claim_id,
              memory_id: memory.memory_id,
              text: claim.text,
              epistemic_state: claim.epistemic_state,
              origin: "synthetic",
              recorded_at: memory.created_at,
              valid_from: claim.valid_from ?? null,
              valid_to: claim.valid_to ?? null,
            })),
          )
          .reverse(),
        relationships: [
          {
            relationship_id: "mara-alder",
            from_entity_id: "mara",
            to_entity_id: "alder",
            from_name: "Mara Chen",
            to_name: "Alder Works",
            type: "works_with",
            status: "accepted",
            version: 1,
          },
        ],
      } satisfies EntityDetail;
    },
    async fetchSource(id) {
      await delay();
      const url = urls[id];
      if (!url) throw new Error("Synthetic source not found.");
      const bytes = await (await fetch(url)).arrayBuffer();
      return {
        bytes,
        mediaType: "image/png",
        serverSha256:
          scenario === "corrupt" ? "incorrect" : await sha256Hex(bytes),
      };
    },
    async correctMemory(id, input: CorrectionInput, _key, version) {
      await delay();
      const memory = memories.get(id);
      if (!memory || memory.revision !== version)
        throw new Error("Synthetic revision conflict. Reload memory.");
      if (!input.text?.trim())
        throw new Error("Synthetic correction must contain text.");
      if (input.target === "claim") {
        const claim = memory.claims?.find((c) => c.claim_id === input.claim_id);
        if (!claim) throw new Error("Synthetic claim not found.");
        claim.text = input.text;
        claim.version++;
      } else {
        memory.interpretation.summary = input.text;
        memory.summary = input.text;
      }
      memory.revision++;
      memory.revised_at = new Date().toISOString();
      memory.history?.push({
        revision: memory.revision,
        origin: "user",
        summary: memory.interpretation.summary,
        changed_at: memory.revised_at,
        reason: "Synthetic in-memory correction",
      });
      return structuredClone(memory);
    },
  };
  const captures: ServerCapture[] = seeds.map((memory) => ({
    capture_id: memory.capture_id,
    client_capture_id: memory.capture_id,
    status: "ready",
    source_kind:
      memory.memory_id === "notebook" ? "handwritten_note" : "photo_document",
    captured_at: memory.captured_at,
    timezone: "UTC",
    context_hint: memory.context_hint,
    created_at: memory.created_at,
    stored_at: memory.created_at,
    version: 1,
    memory_id: memory.memory_id,
    processing: null,
    pages: [
      {
        source_id: memory.interpretation.pages[0]!.page_id,
        client_page_id: memory.interpretation.pages[0]!.page_id,
        ordinal: 1,
        media_type: "image/png",
        byte_size: 1,
        declared_sha256: "development-only",
        server_sha256: null,
        upload_state: "verified",
        original_filename: "synthetic.png",
      },
    ],
  }));
  return { api, captures };
}
