// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ProviderSettingsApi, ProviderView } from "../platform/provider-settings";
import { ProviderSettings } from "./ProviderSettings";
afterEach(cleanup);

// Synthetic values only; none of these are real keys.
function views(claudeKey: string | null = null): ProviderView[] {
  return [
    {
      provider: "claude",
      fields: [
        { name: "RECALL_CLAUDE_API_KEY", value: claudeKey, source: claudeKey ? "saved" : "missing" },
        { name: "RECALL_CLAUDE_MODEL", value: "claude-sonnet-5-5", source: "saved" },
        { name: "RECALL_CLAUDE_INPUT_USD_PER_MTOK", value: "3", source: "environment" },
        { name: "RECALL_CLAUDE_OUTPUT_USD_PER_MTOK", value: null, source: "missing" },
        { name: "RECALL_CLAUDE_DAILY_BUDGET_USD", value: null, source: "missing" },
        { name: "RECALL_CLAUDE_MONTHLY_BUDGET_USD", value: null, source: "missing" },
      ],
    },
    {
      provider: "jev",
      fields: ["TYPESAFE_API_KEY", "RECALL_JEV_MODEL", "RECALL_JEV_INPUT_USD_PER_MTOK", "RECALL_JEV_DAILY_BUDGET_USD", "RECALL_JEV_MONTHLY_BUDGET_USD"].map(
        (name) => ({ name, value: name === "TYPESAFE_API_KEY" ? "…wxyz" : "1", source: "saved" as const }),
      ),
    },
  ];
}

function fakeApi(initial = views()): ProviderSettingsApi & { save: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> } {
  let state = initial;
  return {
    status: vi.fn(async () => state),
    save: vi.fn(async () => {
      state = views("…9876");
    }),
    clear: vi.fn(async () => {}),
  };
}

it("shows configuration state, masks keys, and labels environment values", async () => {
  render(<ProviderSettings api={fakeApi()} />);
  const claude = await screen.findByRole("form", { name: "Claude settings" });
  await waitFor(() => expect(within(claude).getByRole("status").textContent).toBe("Not configured"));
  const jev = screen.getByRole("form", { name: "Jev settings" });
  expect(within(jev).getByRole("status").textContent).toBe("Configured");
  const jevKey = within(jev).getByLabelText("API key") as HTMLInputElement;
  expect(jevKey.type).toBe("password");
  expect(jevKey.value).toBe("");
  expect(jevKey.placeholder).toContain("…wxyz");
  expect((within(claude).getByLabelText("Model") as HTMLInputElement).value).toBe("claude-sonnet-5-5");
  const price = within(claude).getByLabelText("Input price (USD per million tokens)") as HTMLInputElement;
  expect(price.value).toBe("");
  expect(price.placeholder).toBe("3 (from environment)");
});

it("submits edited and prefilled fields, then clears the key draft and reports success", async () => {
  const api = fakeApi();
  render(<ProviderSettings api={api} />);
  const claude = await screen.findByRole("form", { name: "Claude settings" });
  await waitFor(() => expect(within(claude).getByRole("status").textContent).toBe("Not configured"));
  fireEvent.change(within(claude).getByLabelText("API key"), { target: { value: "sk-synthetic-not-real" } });
  fireEvent.change(within(claude).getByLabelText("Daily budget (USD)"), { target: { value: "2" } });
  fireEvent.click(within(claude).getByRole("button", { name: "Save Claude" }));
  await screen.findByText("Saved to this computer's credential store.");
  expect(api.save).toHaveBeenCalledWith("claude", {
    RECALL_CLAUDE_API_KEY: "sk-synthetic-not-real",
    RECALL_CLAUDE_MODEL: "claude-sonnet-5-5",
    RECALL_CLAUDE_OUTPUT_USD_PER_MTOK: "10",
    RECALL_CLAUDE_DAILY_BUDGET_USD: "2",
    RECALL_CLAUDE_MONTHLY_BUDGET_USD: "20",
  });
  const key = within(claude).getByLabelText("API key") as HTMLInputElement;
  expect(key.value).toBe("");
  expect(key.placeholder).toContain("…9876");
  expect(document.body.textContent).not.toContain("sk-synthetic-not-real");
});

it("shows native validation errors without losing what was typed", async () => {
  const api = fakeApi();
  api.save.mockRejectedValueOnce(new Error("Daily budget must be a dollar amount above zero, like 2 or 0.25."));
  render(<ProviderSettings api={api} />);
  const claude = await screen.findByRole("form", { name: "Claude settings" });
  await waitFor(() => expect(within(claude).getByRole("status").textContent).toBe("Not configured"));
  fireEvent.change(within(claude).getByLabelText("Daily budget (USD)"), { target: { value: "-1" } });
  fireEvent.click(within(claude).getByRole("button", { name: "Save Claude" }));
  expect((await within(claude).findByRole("alert")).textContent).toContain("Daily budget");
  expect((within(claude).getByLabelText("Daily budget (USD)") as HTMLInputElement).value).toBe("-1");
});

it("removes saved settings for one provider", async () => {
  const api = fakeApi();
  render(<ProviderSettings api={api} />);
  const jev = await screen.findByRole("form", { name: "Jev settings" });
  await waitFor(() => expect(within(jev).getByRole("status").textContent).toBe("Configured"));
  fireEvent.click(within(jev).getByRole("button", { name: "Remove saved Jev settings" }));
  await screen.findByText("Removed saved Jev settings.");
  expect(api.clear).toHaveBeenCalledWith("jev");
});

it("prefills missing fields with published defaults but never overrides saved or environment values", async () => {
  const api = fakeApi();
  render(<ProviderSettings api={api} />);
  const claude = await screen.findByRole("form", { name: "Claude settings" });
  await waitFor(() => expect(within(claude).getByRole("status").textContent).toBe("Not configured"));
  const value = (label: string) => (within(claude).getByLabelText(label) as HTMLInputElement).value;
  expect(value("Output price (USD per million tokens)")).toBe("10");
  expect(value("Daily budget (USD)")).toBe("2");
  expect(value("Monthly budget (USD)")).toBe("20");
  expect(value("Input price (USD per million tokens)")).toBe(""); // set by environment: left alone
  expect(value("API key")).toBe(""); // keys are never prefilled
  const jev = screen.getByRole("form", { name: "Jev settings" });
  expect((within(jev).getByLabelText("Model") as HTMLInputElement).value).toBe("1"); // saved value wins
  expect(api.save).not.toHaveBeenCalled();
});
