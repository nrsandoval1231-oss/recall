import { useEffect, useState } from "react";
import type { ProviderId, ProviderSettingsApi, ProviderView } from "../platform/provider-settings";

interface FieldSpec {
  name: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  /** Prefilled into an empty field; nothing is saved until the user presses Save. */
  defaultValue?: string;
}

const PROVIDERS: { id: ProviderId; title: string; purpose: string; fields: FieldSpec[] }[] = [
  {
    id: "claude",
    title: "Claude",
    purpose: "Reads photos and organizes notes. Get a key at console.anthropic.com. With the Claude Sonnet 5.5 model, prices are prefilled from Anthropic's published rates (USD 2 in / 10 out per million tokens, checked 2026-10-15). For any other model, enter its prices yourself.",
    fields: [
      { name: "RECALL_CLAUDE_API_KEY", label: "API key", secret: true },
      { name: "RECALL_CLAUDE_MODEL", label: "Model", defaultValue: "claude-sonnet-5-5" },
      { name: "RECALL_CLAUDE_INPUT_USD_PER_MTOK", label: "Input price (USD per million tokens)", defaultValue: "2" },
      { name: "RECALL_CLAUDE_OUTPUT_USD_PER_MTOK", label: "Output price (USD per million tokens)", defaultValue: "10" },
      { name: "RECALL_CLAUDE_DAILY_BUDGET_USD", label: "Daily budget (USD)", defaultValue: "2" },
      { name: "RECALL_CLAUDE_MONTHLY_BUDGET_USD", label: "Monthly budget (USD)", defaultValue: "20" },
    ],
  },
  {
    id: "jev",
    title: "Jev",
    purpose: "Parses captures into structured, source-linked notes before Claude organizes them.",
    fields: [
      { name: "TYPESAFE_API_KEY", label: "API key", secret: true },
      { name: "RECALL_JEV_MODEL", label: "Model", defaultValue: "jev-1.13.0" },
      { name: "RECALL_JEV_INPUT_USD_PER_MTOK", label: "Input price (USD per million tokens)", placeholder: "from the provider's pricing page" },
      { name: "RECALL_JEV_DAILY_BUDGET_USD", label: "Daily budget (USD)", defaultValue: "2" },
      { name: "RECALL_JEV_MONTHLY_BUDGET_USD", label: "Monthly budget (USD)", defaultValue: "20" },
    ],
  },
];

// Published prices belong to one model; they are prefilled only while that model is selected.
const PRICED_MODEL = { model: "RECALL_CLAUDE_MODEL", value: "claude-sonnet-5-5" };
const MODEL_PRICES = new Set(["RECALL_CLAUDE_INPUT_USD_PER_MTOK", "RECALL_CLAUDE_OUTPUT_USD_PER_MTOK"]);
const DEFAULTS = new Map(PROVIDERS.flatMap((p) => p.fields.filter((f) => f.defaultValue).map((f) => [f.name, f.defaultValue!] as const)));
const SECRET_FIELDS = new Set(PROVIDERS.flatMap((p) => p.fields.filter((f) => f.secret).map((f) => f.name)));

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Settings → AI providers. Keys are write-only from here; only a masked suffix is ever shown. */
export function ProviderSettings({ api }: { api: ProviderSettingsApi }) {
  const [views, setViews] = useState<ProviderView[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Price fields holding an untouched prefill, so a model change can withdraw them.
  const [prefilledPrices, setPrefilledPrices] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [notice, setNotice] = useState<{ provider: ProviderId; text: string; error?: boolean } | null>(null);

  function apply(next: ProviderView[]) {
    setViews(next);
    const values: Record<string, string> = {};
    for (const view of next)
      for (const field of view.fields)
        if (field.source === "saved" && !SECRET_FIELDS.has(field.name)) values[field.name] = field.value ?? "";
        else if (field.source === "missing" && DEFAULTS.has(field.name) && !MODEL_PRICES.has(field.name))
          values[field.name] = DEFAULTS.get(field.name)!;
    const model = next.flatMap((v) => v.fields).find((f) => f.name === PRICED_MODEL.model);
    const effectiveModel = values[PRICED_MODEL.model] ?? model?.value ?? "";
    const prefilled = new Set<string>();
    if (effectiveModel === PRICED_MODEL.value)
      for (const field of next.flatMap((v) => v.fields))
        if (MODEL_PRICES.has(field.name) && field.source === "missing") {
          values[field.name] = DEFAULTS.get(field.name)!;
          prefilled.add(field.name);
        }
    setDrafts(values);
    setPrefilledPrices(prefilled);
  }

  async function refresh() {
    apply(await api.status());
  }

  useEffect(() => {
    let live = true;
    api.status().then(
      (next) => live && apply(next),
      (error) => live && setNotice({ provider: "claude", text: message(error), error: true }),
    );
    return () => {
      live = false;
    };
  }, [api]);

  function edit(name: string, value: string) {
    if (MODEL_PRICES.has(name)) {
      setPrefilledPrices((p) => new Set([...p].filter((n) => n !== name)));
      setDrafts((d) => ({ ...d, [name]: value }));
      return;
    }
    setDrafts((d) => {
      const next = { ...d, [name]: value };
      if (name === PRICED_MODEL.model && value.trim() !== PRICED_MODEL.value)
        for (const price of prefilledPrices) delete next[price];
      return next;
    });
    if (name === PRICED_MODEL.model && value.trim() !== PRICED_MODEL.value) setPrefilledPrices(new Set());
  }

  function current(provider: ProviderId, name: string) {
    return views?.find((v) => v.provider === provider)?.fields.find((f) => f.name === name);
  }

  async function run(provider: ProviderId, action: () => Promise<void>, done: string) {
    setBusy(provider);
    setNotice(null);
    try {
      await action();
      await refresh();
      setNotice({ provider, text: done });
    } catch (error) {
      setNotice({ provider, text: message(error), error: true });
    } finally {
      setBusy(null);
    }
  }

  function save(provider: ProviderId, fields: FieldSpec[]) {
    const values: Record<string, string> = {};
    for (const field of fields) {
      const draft = drafts[field.name];
      if (draft !== undefined) values[field.name] = draft;
    }
    return run(provider, () => api.save(provider, values), "Saved to this computer's credential store.");
  }

  return (
    <section className="ms-knowledge-settings ms-provider-settings" aria-label="AI providers">
      <h3>AI providers</h3>
      <p>
        Recall saves and searches your notes without these. Add keys to let Jev and Claude organize captures. Keys stay in this
        computer's credential store and are never shown again. Calls stop at your budgets.
      </p>
      {PROVIDERS.map((provider) => {
        const configured = provider.fields.every((f) => current(provider.id, f.name)?.source !== "missing");
        return (
          <form
            key={provider.id}
            aria-label={`${provider.title} settings`}
            onSubmit={(event) => {
              event.preventDefault();
              void save(provider.id, provider.fields);
            }}
          >
            <h4>
              {provider.title} <small role="status">{views ? (configured ? "Configured" : "Not configured") : "Checking…"}</small>
            </h4>
            <p>{provider.purpose}</p>
            {provider.fields.map((field) => {
              const now = current(provider.id, field.name);
              const fromEnv = now?.source === "environment";
              return (
                <label key={field.name} className="ms-provider-field">
                  <span>{field.label}</span>
                  <input
                    type={field.secret ? "password" : "text"}
                    autoComplete="off"
                    spellCheck={false}
                    value={drafts[field.name] ?? ""}
                    placeholder={
                      field.secret
                        ? now?.value
                          ? `Saved key ${now.value}. Paste a new one to replace it.`
                          : "Paste your key"
                        : fromEnv
                          ? `${now?.value} (from environment)`
                          : field.placeholder
                    }
                    onChange={(event) => edit(field.name, event.target.value)}
                    disabled={busy !== null || !views}
                  />
                </label>
              );
            })}
            <div className="ms-actions">
              <button type="submit" disabled={busy !== null || !views}>
                Save {provider.title}
              </button>
              <button
                type="button"
                disabled={busy !== null || !views}
                onClick={() => void run(provider.id, () => api.clear(provider.id), `Removed saved ${provider.title} settings.`)}
              >
                Remove saved {provider.title} settings
              </button>
            </div>
            {notice?.provider === provider.id && (
              <p role={notice.error ? "alert" : "status"}>{notice.text}</p>
            )}
          </form>
        );
      })}
    </section>
  );
}
