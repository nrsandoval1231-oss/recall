import type { SearchDoc } from "./keyword";

/**
 * SYNTHETIC design fixture. Names, counts, and dates match the owner-supplied
 * Memory Surface reference (2026-10-10). They are not customer memory and
 * they are not inferred from a photograph.
 */
export const FIXTURE_BANNER =
  "Synthetic demo. Brooks Campus is a design fixture from the owner reference, not your notes.";

export interface FixturePerson {
  name: string;
  role: string;
  note: string;
}
export interface FixturePlace {
  name: string;
  locality: string;
  note: string;
}
export interface FixtureCount {
  label: string;
  count: number;
  note: string;
}
export interface FixtureMemory {
  id: string;
  title: string;
  kind: "Notebook" | "Photo" | "Email" | "Document";
  date: string;
  month: "MAY" | "JUN" | "JUL" | "AUG" | "SEP" | "OCT";
  text: string;
}

const notebook = [
  "Brooks Campus  8/16/26",
  "Met w/ Brad + Blake",
  "Temporary generation likely",
  "Oncor timeline ~ Q1 2027",
  "Need site walk w/ Prism",
  "Discussed laydown yard (north side)",
  "Potential 300MW (phased)",
].join("\n");

export const brooks = {
  project: "Brooks Campus",
  kicker: "PROJECT",
  place: "Data Center Project · Lubbock, Texas",
  summary:
    "A 300MW data center campus in Lubbock, TX. Discussions include power infrastructure, temporary generation, utility coordination, and construction timeline.",
  caveat:
    "Synthetic illustration. The sample notebook says “Potential 300MW (phased),” which is not a confirmed capacity. “Likely” and “~ Q1 2027” stay approximate.",
  updated: "Oct 7, 2026",
  stats: { memories: 17, people: 6, locations: 4, topics: 3 },
  statsNote: "Counts match the reference illustration, not a live tally of these four sample notes.",
  morePeople: "3 more people in the illustration. They are not separate records.",
  morePlaces: "1 more location in the illustration. It is not a separate record.",
  people: [
    {
      name: "Blake Combs",
      role: "Project Manager",
      note: "Illustration role. The sample notebook says “Met w/ Brad + Blake.” It does not confirm a title.",
    },
    {
      name: "Brad Stauffer",
      role: "Utility Coordination",
      note: "Illustration role. The sample notebook says “Oncor timeline ~ Q1 2027.” The tilde means the date is approximate.",
    },
    {
      name: "Sarah Mitchell",
      role: "Engineering",
      note: "Illustration role only. No sample note describes her work. Do not treat the role as a verified fact.",
    },
  ] satisfies FixturePerson[],
  places: [
    {
      name: "Brooks Campus",
      locality: "Lubbock, Texas",
      note: "The project place named on the reference board and in the sample notebook.",
    },
    {
      name: "Oncor Substation",
      locality: "Lubbock, Texas",
      note: "Named on the reference board. The notebook mentions an Oncor timeline, not a confirmed substation visit.",
    },
    {
      name: "Temporary Gen Site",
      locality: "North Lot",
      note: "The notebook discusses a laydown yard on the north side and says temporary generation is likely.",
    },
  ] satisfies FixturePlace[],
  topics: [
    { label: "Power Infrastructure", count: 8, note: "Illustration count. The summary names power infrastructure. No separate note measures it." },
    { label: "Temporary Generation", count: 6, note: "The notebook says temporary generation is likely." },
    { label: "Utility Coordination", count: 5, note: "Illustration count. Brad Stauffer’s board role is Utility Coordination." },
    { label: "Construction Timeline", count: 5, note: "The notebook says the Oncor timeline is ~ Q1 2027." },
    { label: "Permitting", count: 3, note: "Illustration label only. No sample note describes a permit." },
  ] satisfies FixtureCount[],
  related: [
    { label: "FingerMotion", count: 12, note: "Illustration label only. No sample note describes FingerMotion." },
    { label: "Oncor", count: 7, note: "The notebook mentions an Oncor timeline of ~ Q1 2027." },
    { label: "Prism Electric", count: 6, note: "The notebook says a site walk with Prism is needed. That is not a recorded contract." },
    { label: "Lubbock", count: 9, note: "The board places Brooks Campus in Lubbock, Texas." },
    { label: "Pecos County", count: 4, note: "Illustration label only. No sample note describes Pecos County." },
  ] satisfies FixtureCount[],
  equipment: [
    { label: "Temporary generation", count: 1, note: "The sample notebook says temporary generation is likely. Likely is not a confirmed plan." },
    { label: "Prism Electric", count: 1, note: "The sample notebook says a site walk with Prism is needed. That is not a recorded contract." },
  ] satisfies FixtureCount[],
  months: ["MAY", "JUN", "JUL", "AUG", "SEP", "OCT"] as const,
  marker: "AUG",
  memories: [
    {
      id: "meeting-notes",
      title: "Meeting Notes",
      kind: "Notebook",
      date: "Aug 16, 2026",
      month: "AUG",
      text: notebook,
    },
    {
      id: "site-visit",
      title: "Site Visit",
      kind: "Photo",
      date: "Aug 21, 2026",
      month: "AUG",
      text: "Synthetic site-visit card for the north side laydown yard. It does not establish construction progress.",
    },
    {
      id: "utility-discussion",
      title: "Utility Discussion",
      kind: "Email",
      date: "Sep 3, 2026",
      month: "SEP",
      text: "Synthetic utility discussion with Brad Stauffer about the Oncor timeline. The notebook says ~ Q1 2027. That date is approximate, not a confirmed deadline.",
    },
    {
      id: "preliminary-plan",
      title: "Preliminary Plan",
      kind: "Document",
      date: "Sep 14, 2026",
      month: "SEP",
      text: "Synthetic preliminary plan. The notebook says potential 300MW, phased. The word potential is unresolved.",
    },
  ] satisfies FixtureMemory[],
  notebook,
  quote: "The details you capture today become the clarity you rely on tomorrow.",
  editorial: "Some notes. A sharper tomorrow.",
};

export function fixtureDocuments(): SearchDoc[] {
  const docs: SearchDoc[] = [
    { id: "project", title: brooks.project, text: `${brooks.summary}\n${brooks.caveat}\n${brooks.place}` },
    ...brooks.memories.map((memory) => ({ id: memory.id, title: memory.title, text: memory.text })),
    ...brooks.people.map((person) => ({ id: `person:${person.name}`, title: person.name, text: `${person.role}. ${person.note}` })),
    ...brooks.places.map((place) => ({ id: `place:${place.name}`, title: place.name, text: `${place.locality}. ${place.note}` })),
    ...brooks.topics.map((topic) => ({ id: `topic:${topic.label}`, title: topic.label, text: topic.note })),
    ...brooks.related.map((item) => ({ id: `related:${item.label}`, title: item.label, text: item.note })),
    ...brooks.equipment.map((item) => ({ id: `equipment:${item.label}`, title: item.label, text: item.note })),
  ];
  return docs;
}

export function fixtureMemory(id: string): FixtureMemory | undefined {
  return brooks.memories.find((memory) => memory.id === id);
}
