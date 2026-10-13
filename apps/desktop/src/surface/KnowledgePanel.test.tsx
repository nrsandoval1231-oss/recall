// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { KnowledgeRelationship, VaultMemory } from "../platform/local-vault";
import { KnowledgePanel } from "./KnowledgePanel";
afterEach(cleanup);

const note: VaultMemory = { id: "source-1", revision: 2, note: "A source-backed note", source_name: "meeting.md", source_sha256: "a".repeat(64), captured_at: "2026-01-01", updated_at: "2026-01-02", conflict: null, state: "active", note_path: "meeting.md" };
function relation(index: number, invalid_at: string | null = null): KnowledgeRelationship {
  return { id: `fact-${index}`, source_id: note.id, revision: 2, source_sha256: note.source_sha256, note_sha256: "b".repeat(64), source_name: note.source_name, note_path: note.note_path!, quote: "The meeting note says the site opens in May.", subject_id: `entity-${index}`, subject: `Site ${index}`, subject_type: "Place", predicate: index % 2 ? "WORKS_ON" : "located_at", object_id: "entity-target", object: "May", object_type: index % 2 ? "Person" : "Date", fact: `Site ${index} opens in May`, valid_at: null, invalid_at, extracted_at: "2026-01-03T00:00:00Z", inferred: true, uncertainty: "Inferred from note text.", related_source_ids: [], supports: [{ source_id: note.id, revision: 2, source_sha256: note.source_sha256, note_sha256: "b".repeat(64), quote: "The meeting note says the site opens in May." }] };
}

it("filters current and superseded facts, expands a bounded list, and opens supporting note actions", async () => {
  const onInspect = vi.fn(), onCorrect = vi.fn(), onDismiss = vi.fn();
  const secondNote = { ...note, id: "source-2", source_name: "decision.md" };
  const selectedFact = relation(2, "2026-02-01");
  selectedFact.supports.push({ source_id: secondNote.id, revision: 1, source_sha256: "c".repeat(64), note_sha256: "d".repeat(64), quote: "A second supporting record confirms the May date." });
  render(<KnowledgePanel relationships={[relation(1), selectedFact, ...Array.from({ length: 13 }, (_, i) => relation(i + 3))]} memories={[note, secondNote]} onInspect={onInspect} onCorrect={onCorrect} onDismiss={onDismiss} />);
  expect(screen.getAllByRole("listitem")).toHaveLength(12);
  fireEvent.change(screen.getByLabelText("Relationship time"), { target: { value: "superseded" } });
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByText(/Superseded 2026-02-01/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Relationship time"), { target: { value: "all" } });
  fireEvent.change(screen.getByLabelText("Relationship type"), { target: { value: "located_at" } });
  expect(screen.getAllByRole("listitem")).toHaveLength(7);
  expect(screen.getByRole("option", { name: "Works on" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Relationship type"), { target: { value: "all" } });
  fireEvent.change(screen.getByLabelText("Entity type"), { target: { value: "Person" } });
  expect(screen.getAllByRole("listitem")).toHaveLength(8);
  fireEvent.change(screen.getByLabelText("Entity type"), { target: { value: "all" } });
  fireEvent.click(screen.getByRole("button", { name: /Expand connections/ }));
  expect(screen.getAllByRole("listitem")).toHaveLength(15);
  fireEvent.click(screen.getByRole("button", { name: /Site 2 Place/ }));
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: /Expand neighbors/ }));
  expect(screen.getAllByRole("listitem")).toHaveLength(15);
  expect(screen.getByRole("heading", { name: "Site 2 opens in May" })).toBeTruthy();
  expect(screen.getByText("A second supporting record confirms the May date.")).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Inspect original" })[0]!);
  fireEvent.click(screen.getAllByRole("button", { name: "Correct note" })[0]!);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss this inferred relationship" }));
  expect(onInspect).toHaveBeenCalledWith(note); expect(onCorrect).toHaveBeenCalledWith(note); expect(onDismiss).toHaveBeenCalledWith("fact-2");
});

it("keeps a relationship visible when native dismissal fails", async () => {
  const onDismiss = vi.fn(async () => { throw new Error("write failed"); });
  render(<KnowledgePanel relationships={[relation(1)]} memories={[note]} onInspect={vi.fn()} onCorrect={vi.fn()} onDismiss={onDismiss} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Dismiss this inferred relationship" })));
  expect(screen.getByRole("button", { name: "Dismiss this inferred relationship" })).toBeTruthy();
  expect(screen.getByText("Site 1 opens in May")).toBeTruthy();
});

it("offers an honest empty state when providers or the graph are unavailable", () => {
  render(<KnowledgePanel relationships={[]} status={{ state: "unavailable", pending: 0, indexed: 0, failed: 0, message: "Local graph service is not configured." }} memories={[]} onInspect={vi.fn()} onCorrect={vi.fn()} />);
  expect(screen.getByRole("status").textContent).toContain("unavailable");
  expect(screen.getByText("Local graph service is not configured.")).toBeTruthy();
});
