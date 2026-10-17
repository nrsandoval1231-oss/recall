//! Provider settings entered in the desktop Settings screen. Values live in the OS credential
//! store under one fixed service. The webview may save or clear a fixed set of named fields;
//! it never reads an API key back, only a masked suffix. Saved values take precedence over the
//! process environment, which remains a fallback for developer setups.

use serde::Serialize;
use std::collections::HashMap;

const SERVICE: &str = "app.recall.desktop.providers";
const MAX_KEY_LEN: usize = 2000;
const MAX_MODEL_LEN: usize = 128;

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Secret,
    Model,
    Usd,
}

struct Field {
    provider: &'static str,
    name: &'static str,
    kind: Kind,
}

const FIELDS: &[Field] = &[
    Field { provider: "claude", name: "RECALL_CLAUDE_API_KEY", kind: Kind::Secret },
    Field { provider: "claude", name: "RECALL_CLAUDE_MODEL", kind: Kind::Model },
    Field { provider: "claude", name: "RECALL_CLAUDE_INPUT_USD_PER_MTOK", kind: Kind::Usd },
    Field { provider: "claude", name: "RECALL_CLAUDE_OUTPUT_USD_PER_MTOK", kind: Kind::Usd },
    Field { provider: "claude", name: "RECALL_CLAUDE_DAILY_BUDGET_USD", kind: Kind::Usd },
    Field { provider: "claude", name: "RECALL_CLAUDE_MONTHLY_BUDGET_USD", kind: Kind::Usd },
    Field { provider: "jev", name: "TYPESAFE_API_KEY", kind: Kind::Secret },
    Field { provider: "jev", name: "RECALL_JEV_MODEL", kind: Kind::Model },
    Field { provider: "jev", name: "RECALL_JEV_INPUT_USD_PER_MTOK", kind: Kind::Usd },
    Field { provider: "jev", name: "RECALL_JEV_DAILY_BUDGET_USD", kind: Kind::Usd },
    Field { provider: "jev", name: "RECALL_JEV_MONTHLY_BUDGET_USD", kind: Kind::Usd },
];

pub(crate) trait Store {
    fn get(&self, name: &str) -> Result<Option<String>, String>;
    fn set(&self, name: &str, value: &str) -> Result<(), String>;
    fn remove(&self, name: &str) -> Result<(), String>;
}

struct Keyring;

impl Store for Keyring {
    fn get(&self, name: &str) -> Result<Option<String>, String> {
        if disabled() { return Ok(None); }
        let entry = keyring::Entry::new(SERVICE, name).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        keyring::Entry::new(SERVICE, name)
            .and_then(|entry| entry.set_password(value))
            .map_err(|e| e.to_string())
    }
    fn remove(&self, name: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(SERVICE, name).map_err(|e| e.to_string())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

fn clean(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// The configured value for one setting: saved value first, then the environment.
/// A credential-store failure falls back to the environment rather than failing the caller.
pub fn lookup(name: &str) -> Option<String> {
    if disabled() { return None; }
    lookup_with(&Keyring, name, |n| std::env::var(n).ok())
}
/// Nonpersistent synthetic validation fence, checked before credential access and network setup.
pub(crate) fn disabled() -> bool { std::env::var("RECALL_DISABLE_PROVIDERS").as_deref() == Ok("1") }

#[cfg(test)]
#[test]
fn synthetic_environment_fences_runtime_credentials_and_transport() {
    // The controller enables this flag for the complete synthetic native suite.
    if disabled() {
        assert!(lookup("RECALL_CLAUDE_API_KEY").is_none());
        assert!(lookup("TYPESAFE_API_KEY").is_none());
        assert!(crate::librarian::provider_agent(1).is_err());
    }
}

fn lookup_with(store: &dyn Store, name: &str, env: impl Fn(&str) -> Option<String>) -> Option<String> {
    clean(store.get(name).ok().flatten()).or_else(|| clean(env(name)))
}

#[derive(Debug, Serialize, PartialEq)]
pub struct FieldView {
    name: &'static str,
    /// Non-secret value, or `…abcd` for a key. Never the full key.
    value: Option<String>,
    source: &'static str,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct ProviderView {
    provider: &'static str,
    fields: Vec<FieldView>,
}

fn mask(key: &str) -> String {
    let tail: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    if key.chars().count() <= 8 { "…".into() } else { format!("…{tail}") }
}

fn status_with(store: &dyn Store, env: impl Fn(&str) -> Option<String>) -> Vec<ProviderView> {
    ["claude", "jev"]
        .into_iter()
        .map(|provider| ProviderView {
            provider,
            fields: FIELDS
                .iter()
                .filter(|f| f.provider == provider)
                .map(|f| {
                    let saved = clean(store.get(f.name).ok().flatten());
                    let (value, source) = match (saved, clean(env(f.name))) {
                        (Some(v), _) => (Some(v), "saved"),
                        (None, Some(v)) => (Some(v), "environment"),
                        (None, None) => (None, "missing"),
                    };
                    let value = if f.kind == Kind::Secret { value.as_deref().map(mask) } else { value };
                    FieldView { name: f.name, value, source }
                })
                .collect(),
        })
        .collect()
}

fn validate(field: &Field, value: &str) -> Result<(), String> {
    match field.kind {
        Kind::Secret => {
            if value.len() > MAX_KEY_LEN || value.chars().any(|c| c.is_control() || c.is_whitespace()) {
                return Err("That API key doesn't look right. Paste it again without spaces.".into());
            }
        }
        Kind::Model => {
            let ok = value.len() <= MAX_MODEL_LEN
                && value.bytes().all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b));
            if !ok {
                return Err("Model names use letters, numbers, dots, dashes or colons.".into());
            }
        }
        Kind::Usd => match crate::librarian::usd_to_micros(value) {
            Ok(micros) if micros > 0 => {}
            _ => return Err(format!("{} must be a dollar amount above zero, like 2 or 0.25.", label(field.name))),
        },
    }
    Ok(())
}

fn label(name: &str) -> &'static str {
    match name {
        n if n.ends_with("INPUT_USD_PER_MTOK") => "Input price",
        n if n.ends_with("OUTPUT_USD_PER_MTOK") => "Output price",
        n if n.ends_with("DAILY_BUDGET_USD") => "Daily budget",
        n if n.ends_with("MONTHLY_BUDGET_USD") => "Monthly budget",
        _ => "This value",
    }
}

/// Validates every submitted field before writing any. An empty key keeps the saved key;
/// an empty non-secret field removes the saved value.
fn save_with(store: &dyn Store, provider: &str, values: &HashMap<String, String>) -> Result<(), String> {
    let fields: Vec<&Field> = FIELDS.iter().filter(|f| f.provider == provider).collect();
    if fields.is_empty() {
        return Err("Unknown provider.".into());
    }
    if let Some(unknown) = values.keys().find(|k| !fields.iter().any(|f| f.name == k.as_str())) {
        return Err(format!("Unknown setting {unknown}."));
    }
    let mut writes = Vec::new();
    for field in &fields {
        let Some(raw) = values.get(field.name) else { continue };
        let value = raw.trim();
        if value.is_empty() {
            if field.kind != Kind::Secret {
                writes.push((field.name, None));
            }
            continue;
        }
        validate(field, value)?;
        writes.push((field.name, Some(value.to_string())));
    }
    for (name, value) in writes {
        match value {
            Some(v) => store.set(name, &v)?,
            None => store.remove(name)?,
        }
    }
    Ok(())
}

fn clear_with(store: &dyn Store, provider: &str) -> Result<(), String> {
    let mut any = false;
    for field in FIELDS.iter().filter(|f| f.provider == provider) {
        any = true;
        store.remove(field.name)?;
    }
    if any { Ok(()) } else { Err("Unknown provider.".into()) }
}

#[tauri::command]
pub fn provider_settings_status() -> Vec<ProviderView> {
    status_with(&Keyring, |n| std::env::var(n).ok())
}

#[tauri::command]
pub fn provider_settings_save(provider: String, values: HashMap<String, String>) -> Result<(), String> {
    save_with(&Keyring, &provider, &values)
}

#[tauri::command]
pub fn provider_settings_clear(provider: String) -> Result<(), String> {
    clear_with(&Keyring, &provider)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct Memory(RefCell<HashMap<String, String>>);
    impl Store for Memory {
        fn get(&self, name: &str) -> Result<Option<String>, String> {
            Ok(self.0.borrow().get(name).cloned())
        }
        fn set(&self, name: &str, value: &str) -> Result<(), String> {
            self.0.borrow_mut().insert(name.into(), value.into());
            Ok(())
        }
        fn remove(&self, name: &str) -> Result<(), String> {
            self.0.borrow_mut().remove(name);
            Ok(())
        }
    }
    struct Broken;
    impl Store for Broken {
        fn get(&self, _: &str) -> Result<Option<String>, String> { Err("locked".into()) }
        fn set(&self, _: &str, _: &str) -> Result<(), String> { Err("locked".into()) }
        fn remove(&self, _: &str) -> Result<(), String> { Err("locked".into()) }
    }

    fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }
    fn env_with(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |n| pairs.iter().find(|(k, _)| *k == n).map(|(_, v)| v.to_string())
    }

    #[test]
    fn saved_value_wins_over_environment_and_blank_falls_back() {
        let store = Memory::default();
        let env = env_with(&[("RECALL_CLAUDE_MODEL", "env-model")]);
        assert_eq!(lookup_with(&store, "RECALL_CLAUDE_MODEL", &env).as_deref(), Some("env-model"));
        store.set("RECALL_CLAUDE_MODEL", "saved-model").unwrap();
        assert_eq!(lookup_with(&store, "RECALL_CLAUDE_MODEL", &env).as_deref(), Some("saved-model"));
        store.set("RECALL_CLAUDE_MODEL", "  ").unwrap();
        assert_eq!(lookup_with(&store, "RECALL_CLAUDE_MODEL", &env).as_deref(), Some("env-model"));
    }

    #[test]
    fn credential_store_failure_falls_back_to_environment() {
        let env = env_with(&[("TYPESAFE_API_KEY", "synthetic-env-key")]);
        assert_eq!(lookup_with(&Broken, "TYPESAFE_API_KEY", env).as_deref(), Some("synthetic-env-key"));
    }

    #[test]
    fn status_masks_keys_and_reports_sources() {
        let store = Memory::default();
        store.set("RECALL_CLAUDE_API_KEY", "sk-synthetic-not-real-1234").unwrap();
        let env = env_with(&[("RECALL_CLAUDE_MODEL", "env-model")]);
        let views = status_with(&store, env);
        let claude = &views[0];
        assert_eq!(claude.provider, "claude");
        let key = &claude.fields[0];
        assert_eq!((key.value.as_deref(), key.source), (Some("…1234"), "saved"));
        assert!(!serde_json::to_string(&views).unwrap().contains("synthetic-not-real"));
        assert_eq!((claude.fields[1].value.as_deref(), claude.fields[1].source), (Some("env-model"), "environment"));
        assert_eq!(claude.fields[2].source, "missing");
        assert_eq!(views[1].provider, "jev");
        assert_eq!(mask("short"), "…");
    }

    #[test]
    fn save_validates_everything_before_writing_anything() {
        let store = Memory::default();
        let err = save_with(&store, "claude", &values(&[
            ("RECALL_CLAUDE_API_KEY", "sk-synthetic"),
            ("RECALL_CLAUDE_DAILY_BUDGET_USD", "-1"),
        ])).unwrap_err();
        assert!(err.contains("Daily budget"));
        assert!(store.0.borrow().is_empty());
        for bad in ["0", "abc", "1.2.3", ".5"] {
            assert!(save_with(&store, "claude", &values(&[("RECALL_CLAUDE_MONTHLY_BUDGET_USD", bad)])).is_err(), "{bad}");
        }
        assert!(save_with(&store, "claude", &values(&[("RECALL_CLAUDE_API_KEY", "has space")])).is_err());
        assert!(save_with(&store, "claude", &values(&[("RECALL_CLAUDE_MODEL", "bad/model")])).is_err());
    }

    #[test]
    fn save_rejects_other_providers_fields_and_unknown_providers() {
        let store = Memory::default();
        assert!(save_with(&store, "claude", &values(&[("TYPESAFE_API_KEY", "synthetic")])).is_err());
        assert!(save_with(&store, "claude", &values(&[("PATH", "x")])).is_err());
        assert!(save_with(&store, "openai", &values(&[])).is_err());
        assert!(clear_with(&store, "openai").is_err());
        assert!(store.0.borrow().is_empty());
    }

    #[test]
    fn blank_key_keeps_saved_key_and_blank_field_removes_value() {
        let store = Memory::default();
        save_with(&store, "jev", &values(&[
            ("TYPESAFE_API_KEY", " synthetic-jev-key "),
            ("RECALL_JEV_MODEL", "jev-1.13.0"),
            ("RECALL_JEV_INPUT_USD_PER_MTOK", "0.42"),
        ])).unwrap();
        assert_eq!(store.get("TYPESAFE_API_KEY").unwrap().as_deref(), Some("synthetic-jev-key"));
        save_with(&store, "jev", &values(&[("TYPESAFE_API_KEY", ""), ("RECALL_JEV_MODEL", "")])).unwrap();
        assert_eq!(store.get("TYPESAFE_API_KEY").unwrap().as_deref(), Some("synthetic-jev-key"));
        assert_eq!(store.get("RECALL_JEV_MODEL").unwrap(), None);
        assert_eq!(store.get("RECALL_JEV_INPUT_USD_PER_MTOK").unwrap().as_deref(), Some("0.42"));
        clear_with(&store, "jev").unwrap();
        assert!(store.0.borrow().is_empty());
    }
}
