// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopEntry } from "../entry";
import { readConfig } from "../config";
import { createAuth } from "@recall/api-client";
vi.mock("../config", () => ({ readConfig: vi.fn(() => ({ missing: ["VITE_API_BASE_URL"] })) }));
vi.mock("@recall/api-client", async (importOriginal) => ({ ...await importOriginal<typeof import("@recall/api-client")>(), createAuth: vi.fn(), RecallApiClient: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("default entry never reads cloud config or constructs cloud auth", async () => {
  render(<DesktopEntry search="" />);
  await screen.findByText(/Open the Recall desktop app/);
  expect(readConfig).not.toHaveBeenCalled(); expect(createAuth).not.toHaveBeenCalled();
});
it("explicit legacy-cloud compatibility preserves its configuration gate", async () => {
  render(<DesktopEntry search="?mode=legacy-cloud" />);
  expect(await screen.findByText("Recall isn't configured")).toBeTruthy();
  expect(readConfig).toHaveBeenCalled(); expect(createAuth).not.toHaveBeenCalled();
});
