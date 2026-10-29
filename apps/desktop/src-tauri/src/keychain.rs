//! OS credential store access with a one-way migration from the pre-rename `app.recall.desktop.*`
//! service names to `app.monolith.desktop.*`.
//!
//! Reads try the new service first and then the legacy one. A legacy hit is copied to the new
//! service, read back and compared, and only then is the legacy entry deleted; if the copy or the
//! verification fails the legacy entry is kept and the value is still returned, so a paired-device
//! secret is never lost. Writes go to the new service only. Removal clears both services.

use keyring::Entry;

type Result<T> = std::result::Result<T, String>;

pub(crate) const SESSION_SERVICE: &str = "app.monolith.desktop.session";
pub(crate) const SESSION_SERVICE_LEGACY: &str = "app.recall.desktop.session";
pub(crate) const READING_SERVICE: &str = "app.monolith.desktop.selected-photo-reading";
pub(crate) const READING_SERVICE_LEGACY: &str = "app.recall.desktop.selected-photo-reading";
pub(crate) const INTELLIGENCE_SERVICE: &str = "app.monolith.desktop.vault-intelligence";
pub(crate) const INTELLIGENCE_SERVICE_LEGACY: &str = "app.recall.desktop.vault-intelligence";

/// The credential-store operations the pairing and secret code needs. Production uses the OS
/// store; tests substitute in-memory stores that can inject failures.
pub(crate) trait SecretStore {
    fn load(&self, key: &str) -> Result<Option<String>>;
    fn save(&self, key: &str, value: &str) -> Result<()>;
    fn remove(&self, key: &str) -> Result<()>;
}

/// One service in the OS credential store (Windows Credential Manager on Windows).
pub(crate) struct OsStore {
    service: &'static str,
    /// Fixed user-facing error; `None` passes the keyring error text through.
    message: Option<&'static str>,
}
impl OsStore {
    fn fail(&self, error: &keyring::Error) -> String {
        self.message
            .map_or_else(|| error.to_string(), str::to_owned)
    }
    fn entry(&self, key: &str) -> Result<Entry> {
        Entry::new(self.service, key).map_err(|e| self.fail(&e))
    }
}
impl SecretStore for OsStore {
    fn load(&self, key: &str) -> Result<Option<String>> {
        match self.entry(key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(self.fail(&e)),
        }
    }
    fn save(&self, key: &str, value: &str) -> Result<()> {
        self.entry(key)?
            .set_password(value)
            .map_err(|e| self.fail(&e))
    }
    fn remove(&self, key: &str) -> Result<()> {
        match self.entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(self.fail(&e)),
        }
    }
}

/// Reads fall back to (and migrate from) `legacy`; writes go to `current` only; removal clears both.
pub(crate) struct MigratingStore<C: SecretStore, L: SecretStore> {
    pub(crate) current: C,
    pub(crate) legacy: L,
}
impl<C: SecretStore, L: SecretStore> SecretStore for MigratingStore<C, L> {
    fn load(&self, key: &str) -> Result<Option<String>> {
        if let Some(value) = self.current.load(key)? {
            return Ok(Some(value));
        }
        let Some(value) = self.legacy.load(key)? else {
            // Another process may have migrated the entry between the two reads above.
            return self.current.load(key);
        };
        // Copy forward, prove the copy by reading it back, and only then drop the legacy entry.
        let copied = self.current.save(key, &value).is_ok()
            && matches!(self.current.load(key), Ok(Some(ref stored)) if *stored == value);
        if copied {
            let _ = self.legacy.remove(key);
        } else {
            // Never leave an unverified new entry that would shadow the intact legacy one.
            let _ = self.current.remove(key);
        }
        Ok(Some(value))
    }
    fn save(&self, key: &str, value: &str) -> Result<()> {
        self.current.save(key, value)
    }
    fn remove(&self, key: &str) -> Result<()> {
        // Attempt both so one failure cannot strand a credential in the other service.
        let current = self.current.remove(key);
        let legacy = self.legacy.remove(key);
        current.and(legacy)
    }
}

pub(crate) fn os_store(
    service: &'static str,
    legacy_service: &'static str,
    message: Option<&'static str>,
) -> MigratingStore<OsStore, OsStore> {
    MigratingStore {
        current: OsStore { service, message },
        legacy: OsStore {
            service: legacy_service,
            message,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::BTreeMap, sync::Mutex};

    #[derive(Default)]
    struct Memory {
        values: Mutex<BTreeMap<String, String>>,
        fail_load: bool,
        fail_save: bool,
        fail_remove: bool,
        /// Saves succeed but store something else, as a corrupted write would.
        corrupt_save: bool,
    }
    impl SecretStore for Memory {
        fn load(&self, key: &str) -> Result<Option<String>> {
            if self.fail_load {
                return Err("synthetic load failure".into());
            }
            Ok(self.values.lock().unwrap().get(key).cloned())
        }
        fn save(&self, key: &str, value: &str) -> Result<()> {
            if self.fail_save {
                return Err("synthetic save failure".into());
            }
            let stored = if self.corrupt_save { "corrupt" } else { value };
            self.values
                .lock()
                .unwrap()
                .insert(key.into(), stored.into());
            Ok(())
        }
        fn remove(&self, key: &str) -> Result<()> {
            if self.fail_remove {
                return Err("synthetic remove failure".into());
            }
            self.values.lock().unwrap().remove(key);
            Ok(())
        }
    }
    fn with(store: &Memory, key: &str, value: &str) {
        store
            .values
            .lock()
            .unwrap()
            .insert(key.into(), value.into());
    }
    fn has(store: &Memory, key: &str) -> Option<String> {
        store.values.lock().unwrap().get(key).cloned()
    }
    fn pair(current: Memory, legacy: Memory) -> MigratingStore<Memory, Memory> {
        MigratingStore { current, legacy }
    }

    #[test]
    fn service_names_are_distinct_and_follow_the_rename() {
        let all = [
            SESSION_SERVICE,
            SESSION_SERVICE_LEGACY,
            READING_SERVICE,
            READING_SERVICE_LEGACY,
            INTELLIGENCE_SERVICE,
            INTELLIGENCE_SERVICE_LEGACY,
        ];
        assert_eq!(
            all.iter().collect::<std::collections::BTreeSet<_>>().len(),
            6
        );
        assert!(all[0].starts_with("app.monolith.desktop."));
        assert!(all[1].starts_with("app.recall.desktop."));
        for (new, old) in [
            (SESSION_SERVICE, SESSION_SERVICE_LEGACY),
            (READING_SERVICE, READING_SERVICE_LEGACY),
            (INTELLIGENCE_SERVICE, INTELLIGENCE_SERVICE_LEGACY),
        ] {
            assert_eq!(
                new.strip_prefix("app.monolith.desktop."),
                old.strip_prefix("app.recall.desktop.")
            );
        }
    }

    #[test]
    fn new_entry_wins_and_legacy_is_not_touched_by_a_read() {
        let s = pair(Memory::default(), Memory::default());
        with(&s.current, "k", "new");
        with(&s.legacy, "k", "old");
        assert_eq!(s.load("k").unwrap().as_deref(), Some("new"));
        assert_eq!(has(&s.legacy, "k").as_deref(), Some("old"));
    }

    #[test]
    fn legacy_hit_is_copied_verified_and_then_deleted() {
        let s = pair(Memory::default(), Memory::default());
        with(&s.legacy, "k", "paired-secret");
        assert_eq!(s.load("k").unwrap().as_deref(), Some("paired-secret"));
        assert_eq!(has(&s.current, "k").as_deref(), Some("paired-secret"));
        assert_eq!(has(&s.legacy, "k"), None);
        assert_eq!(s.load("k").unwrap().as_deref(), Some("paired-secret"));
    }

    #[test]
    fn failed_copy_keeps_legacy_and_still_returns_the_value() {
        let s = pair(
            Memory {
                fail_save: true,
                ..Memory::default()
            },
            Memory::default(),
        );
        with(&s.legacy, "k", "paired-secret");
        assert_eq!(s.load("k").unwrap().as_deref(), Some("paired-secret"));
        assert_eq!(has(&s.legacy, "k").as_deref(), Some("paired-secret"));
        assert_eq!(has(&s.current, "k"), None);
    }

    #[test]
    fn unverifiable_copy_keeps_legacy_and_removes_the_bad_new_entry() {
        let s = pair(
            Memory {
                corrupt_save: true,
                ..Memory::default()
            },
            Memory::default(),
        );
        with(&s.legacy, "k", "paired-secret");
        assert_eq!(s.load("k").unwrap().as_deref(), Some("paired-secret"));
        assert_eq!(has(&s.legacy, "k").as_deref(), Some("paired-secret"));
        assert_eq!(
            has(&s.current, "k"),
            None,
            "a corrupt copy must not shadow the legacy value"
        );
    }

    #[test]
    fn failed_legacy_delete_after_a_verified_copy_still_returns_the_value() {
        let s = pair(
            Memory::default(),
            Memory {
                fail_remove: true,
                ..Memory::default()
            },
        );
        with(&s.legacy, "k", "paired-secret");
        assert_eq!(s.load("k").unwrap().as_deref(), Some("paired-secret"));
        assert_eq!(has(&s.current, "k").as_deref(), Some("paired-secret"));
        assert_eq!(has(&s.legacy, "k").as_deref(), Some("paired-secret"));
    }

    #[test]
    fn an_entry_migrated_by_another_process_between_the_reads_is_still_found() {
        use std::sync::Arc;
        struct Shared(Arc<Memory>);
        impl SecretStore for Shared {
            fn load(&self, key: &str) -> Result<Option<String>> {
                self.0.load(key)
            }
            fn save(&self, key: &str, value: &str) -> Result<()> {
                self.0.save(key, value)
            }
            fn remove(&self, key: &str) -> Result<()> {
                self.0.remove(key)
            }
        }
        /// A legacy store that, when read, reports "absent" because a concurrent instance has just
        /// moved the secret into the current service.
        struct Racing(Arc<Memory>);
        impl SecretStore for Racing {
            fn load(&self, key: &str) -> Result<Option<String>> {
                with(&self.0, key, "paired-secret");
                Ok(None)
            }
            fn save(&self, _: &str, _: &str) -> Result<()> {
                Ok(())
            }
            fn remove(&self, _: &str) -> Result<()> {
                Ok(())
            }
        }
        let current = Arc::new(Memory::default());
        let store = MigratingStore {
            current: Shared(current.clone()),
            legacy: Racing(current.clone()),
        };
        assert_eq!(store.load("k").unwrap().as_deref(), Some("paired-secret"));
    }

    #[test]
    fn missing_everywhere_is_none_and_store_failures_are_errors() {
        let s = pair(Memory::default(), Memory::default());
        assert_eq!(s.load("k").unwrap(), None);
        let broken_current = pair(
            Memory {
                fail_load: true,
                ..Memory::default()
            },
            Memory::default(),
        );
        with(&broken_current.legacy, "k", "v");
        assert!(broken_current.load("k").is_err());
        assert_eq!(has(&broken_current.legacy, "k").as_deref(), Some("v"));
        let broken_legacy = pair(
            Memory::default(),
            Memory {
                fail_load: true,
                ..Memory::default()
            },
        );
        assert!(broken_legacy.load("k").is_err());
    }

    #[test]
    fn writes_go_to_the_new_service_only() {
        let s = pair(Memory::default(), Memory::default());
        with(&s.legacy, "k", "old");
        s.save("k", "new").unwrap();
        assert_eq!(has(&s.current, "k").as_deref(), Some("new"));
        assert_eq!(has(&s.legacy, "k").as_deref(), Some("old"));
        assert_eq!(s.load("k").unwrap().as_deref(), Some("new"));
    }

    #[test]
    fn remove_clears_both_services_and_reports_a_failure_after_trying_both() {
        let s = pair(Memory::default(), Memory::default());
        with(&s.current, "k", "new");
        with(&s.legacy, "k", "old");
        s.remove("k").unwrap();
        assert_eq!((has(&s.current, "k"), has(&s.legacy, "k")), (None, None));
        s.remove("k").unwrap();

        let stuck = pair(
            Memory::default(),
            Memory {
                fail_remove: true,
                ..Memory::default()
            },
        );
        with(&stuck.current, "k", "new");
        with(&stuck.legacy, "k", "old");
        assert!(stuck.remove("k").is_err());
        assert_eq!(
            has(&stuck.current, "k"),
            None,
            "the other service is still cleared"
        );
        // A secret that could not be fully revoked must not silently reappear as the new value.
        assert_eq!(has(&stuck.legacy, "k").as_deref(), Some("old"));
    }
}
