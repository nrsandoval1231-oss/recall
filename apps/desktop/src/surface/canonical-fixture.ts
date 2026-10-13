import { brooks } from "./brooks-fixture";

/** Explicit browser-only visual fixture. Never saved, indexed, or sent to a provider. */
export const canonicalFixture = {
  ...brooks,
  project: "Permian Power Expansion",
  place: "Field power. Real opportunity.",
  summary:
    "Tracking power needs, stakeholders, and execution strategy across key Permian Basin projects.",
  caveat: "",
  updated: "Apr 24, 2025",
  statsNote: "",
  morePeople: "3 more people",
  morePlaces: "2 more locations",
  places: [
    {
      name: "Permian Basin",
      locality: "Texas",
      note: "Synthetic reference location.",
    },
    {
      name: "Midland",
      locality: "Texas",
      note: "Synthetic reference location.",
    },
    {
      name: "Odessa",
      locality: "Texas",
      note: "Synthetic reference location.",
    },
  ],
};

export const canonicalNotes = [
  {
    title: "RRC permit review",
    date: "2025-04-22",
    text: "New compression site. Estimate 5–10 MW. No utility timeline confirmed…",
    tags: ["Permits", "5–10 MW"],
  },
  {
    title: "Call with site operator",
    date: "2025-04-20",
    text: "Discussed temporary power options. Interested in 2G units. Follow up…",
    tags: ["Call", "Follow Up"],
  },
  {
    title: "Site layout sketch",
    date: "2025-04-18",
    text: "Hand-drawn layout from site visit. Multiple potential generator locations…",
    tags: ["Site Visit", "Layout"],
  },
  {
    title: "Power demand analysis",
    date: "2025-04-15",
    text: "Initial load estimates and phasing. 8–12 MW total over 24 months.",
    tags: ["Analysis", "Load"],
  },
];
