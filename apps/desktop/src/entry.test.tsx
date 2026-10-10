// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopEntry } from "./entry";
import type { LocalVault } from "./platform/local-vault";

afterEach(cleanup);

const preview: LocalVault = {
  available: false,
  status: async () => ({ root: null, vault_id: null, vault_identity: null }),
  select: async () => null,
  openDefault: async () => ({ root: null, vault_id: null, vault_identity: null }),
  capture: async () => null,
  list: async () => [],
  rebuild: async () => [],
  restoreNote: async () => { throw new Error("unused"); },
  remove: async () => { throw new Error("unused"); },
  correct: async () => { throw new Error("unused"); },
  source: async () => { throw new Error("unused"); },
  history: async () => [],
};

describe("desktop entry", () => {
  it("opens the Memory Surface without an email sign-in", () => {
    render(<DesktopEntry vault={preview} search="" />);
    expect(screen.getByRole("heading", { name: "Brooks Campus" })).toBeTruthy();
    expect(screen.queryByText("Email me a sign-in link")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Email" })).toBeNull();
  });

  it("keeps the cloud client off the happy path", async () => {
    render(<DesktopEntry vault={preview} search="?mode=legacy-cloud" />);
    expect(await screen.findByRole("heading", { name: "Recall isn't configured" })).toBeTruthy();
    expect(screen.queryByText("Brooks Campus")).toBeNull();
    expect(screen.queryByText("Email me a sign-in link")).toBeNull();
  });
});
