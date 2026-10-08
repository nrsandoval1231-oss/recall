//! Native-only owner pairing. The renderer receives no bearer material.
use crate::local_vault::LocalVaultState;
use keyring::Entry;
use reqwest::{blocking::Client, redirect::Policy, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{io::Read, sync::Mutex, time::Duration};
use tauri::State;
use uuid::Uuid;

const SERVICE: &str = "app.recall.desktop.selected-photo-reading";
type Result<T> = std::result::Result<T, String>;
// This lock covers only pairing/keyring lifecycle, never a vault authority lock.
static PAIRING_LIFECYCLE: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Pending {
    device_id: String,
    vault_id: String,
    secret: String,
    origin: String,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct Bound {
    device_id: String,
    vault_id: String,
    scope: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Revocation {
    confirmed: bool,
}
#[derive(Serialize)]
pub struct PairingStatus {
    state: String,
    device_id: Option<String>,
    vault_id: String,
    fingerprint: Option<String>,
    scope: Option<String>,
}

trait PairingStore {
    fn load(&self, key: &str) -> Result<Option<String>>;
    fn save(&self, key: &str, value: &str) -> Result<()>;
    fn remove(&self, key: &str) -> Result<()>;
}
trait PairingTransport {
    fn claim(&self, pending: &Pending, invitation: &Uuid) -> Result<()>;
    fn status(&self, pending: &Pending) -> Result<Bound>;
    fn revoke(&self, pending: &Pending) -> Result<bool>;
}

struct KeyringStore;
impl KeyringStore {
    fn entry(key: &str) -> Result<Entry> {
        Entry::new(SERVICE, key).map_err(|_| "The device keyring is unavailable".into())
    }
}
impl PairingStore for KeyringStore {
    fn load(&self, key: &str) -> Result<Option<String>> {
        match Self::entry(key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("The device keyring is unavailable".into()),
        }
    }
    fn save(&self, key: &str, value: &str) -> Result<()> {
        Self::entry(key)?
            .set_password(value)
            .map_err(|_| "The device keyring is unavailable".into())
    }
    fn remove(&self, key: &str) -> Result<()> {
        let entry = Self::entry(key)?;
        match entry.get_password() {
            Ok(_) => entry
                .delete_credential()
                .map_err(|_| "The device keyring is unavailable".into()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("The device keyring is unavailable".into()),
        }
    }
}

struct HttpsTransport;
fn pinned_origin(raw: &str) -> Result<Url> {
    let url = Url::parse(raw).map_err(|_| "Pairing service is unavailable")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Pairing service is unavailable".into());
    }
    Ok(url)
}
fn configured_origin() -> Result<Url> {
    pinned_origin(option_env!("RECALL_PAIRING_ORIGIN").ok_or("Pairing is disabled in this build")?)
}
fn client() -> Result<Client> {
    Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "Pairing service is unavailable".into())
}
fn bounded_json<T: for<'a> Deserialize<'a>>(
    response: reqwest::blocking::Response,
    error: &str,
) -> Result<T> {
    let mut body = Vec::new();
    response
        .take(4097)
        .read_to_end(&mut body)
        .map_err(|_| error.to_string())?;
    if body.len() > 4096 {
        return Err(error.into());
    }
    serde_json::from_slice(&body).map_err(|_| error.into())
}
impl PairingTransport for HttpsTransport {
    fn claim(&self, pending: &Pending, invitation: &Uuid) -> Result<()> {
        let url = pinned_origin(&pending.origin)?
            .join(&format!("v1/device-pairings/{invitation}/claim"))
            .map_err(|_| "Pairing service is unavailable")?;
        let response = client()?
            .post(url)
            .json(&serde_json::json!({"secret": pending.secret}))
            .send()
            .map_err(|_| "Pairing outcome is unknown; check connection status to recover")?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err("Invitation was not accepted; pairing remains pending".into())
        }
    }
    fn status(&self, pending: &Pending) -> Result<Bound> {
        let url = pinned_origin(&pending.origin)?
            .join("v1/device-pairings/status")
            .map_err(|_| "Pairing service is unavailable")?;
        let response = client()?
            .get(url)
            .bearer_auth(&pending.secret)
            .send()
            .map_err(|_| "Pairing outcome is unknown; check connection status to recover")?;
        if !response.status().is_success() {
            return Err("Device is not connected; pairing remains pending".into());
        }
        bounded_json(response, "Pairing status is unknown; retry status recovery")
    }
    fn revoke(&self, pending: &Pending) -> Result<bool> {
        let url = pinned_origin(&pending.origin)?
            .join("v1/device-pairings")
            .map_err(|_| "Pairing service is unavailable")?;
        let response = client()?
            .delete(url)
            .bearer_auth(&pending.secret)
            .send()
            .map_err(|_| "Revocation outcome is unknown; local credentials were retained")?;
        if !response.status().is_success() {
            return Err("Revocation was not confirmed; local credentials were retained".into());
        }
        Ok(bounded_json::<Revocation>(
            response,
            "Revocation outcome is unknown; local credentials were retained",
        )?
        .confirmed)
    }
}

fn pending_key(vault: &str) -> String {
    format!("pairing.pending.{vault}")
}
fn fingerprint(secret: &str) -> String {
    hex::encode(Sha256::digest(secret.as_bytes()))
}
fn validate_bound(vault: &str, pending: &Pending, bound: &Bound) -> Result<()> {
    if bound.vault_id != vault
        || bound.device_id != pending.device_id
        || bound.scope != "photo_inference"
    {
        return Err("Pairing response scope does not match this device".into());
    }
    Ok(())
}
fn load_pending(store: &impl PairingStore, vault: &str) -> Result<Option<Pending>> {
    let Some(raw) = store.load(&pending_key(vault))? else {
        return Ok(None);
    };
    let pending: Pending =
        serde_json::from_str(&raw).map_err(|_| "Pending pairing data is unavailable")?;
    if pending.vault_id != vault
        || Uuid::parse_str(&pending.device_id).is_err()
        || hex::decode(&pending.secret).map_or(true, |bytes| bytes.len() != 32)
        || pinned_origin(&pending.origin).is_err()
    {
        return Err("Pending pairing data is unavailable".into());
    }
    Ok(Some(pending))
}
fn save_connection(store: &impl PairingStore, vault: &str, pending: &Pending) -> Result<()> {
    #[derive(Serialize)]
    struct Connection<'a> {
        schema_version: &'static str,
        vault_id: &'a str,
        origin: &'a str,
        credential: &'a str,
    }
    let raw = serde_json::to_string(&Connection {
        schema_version: "1.0",
        vault_id: vault,
        origin: pending.origin.trim_end_matches('/'),
        credential: &pending.secret,
    })
    .map_err(|_| "Cannot save protected connection")?;
    store
        .save(vault, &raw)
        .map_err(|_| "Keyring write failed; pairing status is unknown".into())
}
fn pairing_status(
    state: &str,
    vault: &str,
    pending: Option<&Pending>,
    scope: Option<String>,
) -> PairingStatus {
    PairingStatus {
        state: state.into(),
        device_id: pending.map(|p| p.device_id.clone()),
        vault_id: vault.into(),
        fingerprint: pending.map(|p| fingerprint(&p.secret)),
        scope,
    }
}

// All production and synthetic test flows pass through this lifecycle core.
struct PairingCore<'a, S: PairingStore, T: PairingTransport> {
    store: &'a S,
    transport: &'a T,
    gate: &'a Mutex<()>,
}
impl<S: PairingStore, T: PairingTransport> PairingCore<'_, S, T> {
    fn prepare(&self, vault: &str) -> Result<PairingStatus> {
        let _guard = self
            .gate
            .lock()
            .map_err(|_| "Pairing lifecycle unavailable")?;
        if Uuid::parse_str(vault).is_err() {
            return Err("Select a valid vault first".into());
        }
        let pending = if let Some(existing) = load_pending(self.store, vault)? {
            existing
        } else {
            let mut secret_bytes = [0_u8; 32];
            getrandom::fill(&mut secret_bytes)
                .map_err(|_| "The operating system could not generate pairing material")?;
            let pending = Pending {
                device_id: Uuid::new_v4().to_string(),
                vault_id: vault.into(),
                secret: hex::encode(secret_bytes),
                origin: configured_origin()?.to_string(),
            };
            self.store
                .save(
                    &pending_key(vault),
                    &serde_json::to_string(&pending).map_err(|_| "Cannot save pairing material")?,
                )
                .map_err(|_| "The device keyring is unavailable; pairing was not prepared")?;
            pending
        };
        Ok(pairing_status(
            "pending_owner_approval",
            vault,
            Some(&pending),
            Some("photo_inference".into()),
        ))
    }
    fn claim(&self, vault: &str, invitation: &str) -> Result<PairingStatus> {
        let _guard = self
            .gate
            .lock()
            .map_err(|_| "Pairing lifecycle unavailable")?;
        let invitation =
            Uuid::parse_str(invitation).map_err(|_| "Enter a valid owner invitation ID")?;
        let pending = load_pending(self.store, vault)?
            .ok_or("Prepare this device before entering an invitation")?;
        self.transport.claim(&pending, &invitation)?;
        let bound = self.transport.status(&pending)?;
        validate_bound(vault, &pending, &bound)?;
        save_connection(self.store, vault, &pending)?;
        Ok(pairing_status(
            "connected",
            vault,
            Some(&pending),
            Some(bound.scope),
        ))
    }
    fn status(&self, vault: &str) -> Result<PairingStatus> {
        let _guard = self
            .gate
            .lock()
            .map_err(|_| "Pairing lifecycle unavailable")?;
        let pending = match load_pending(self.store, vault) {
            Ok(pending) => pending,
            // A read failure cannot establish absence. Preserve UNKNOWN rather
            // than treating a temporarily inaccessible credential as detached.
            Err(_) => return Ok(pairing_status("unknown", vault, None, None)),
        };
        let Some(pending) = pending else {
            return Ok(pairing_status("disconnected", vault, None, None));
        };
        match self.transport.status(&pending).and_then(|bound| {
            validate_bound(vault, &pending, &bound)?;
            save_connection(self.store, vault, &pending)?;
            Ok(bound)
        }) {
            Ok(bound) => Ok(pairing_status(
                "connected",
                vault,
                Some(&pending),
                Some(bound.scope),
            )),
            Err(_) => Ok(pairing_status("unknown", vault, Some(&pending), None)),
        }
    }
    fn confirmed_active(&self, vault: &str) -> bool {
        matches!(self.status(), Ok(PairingStatus { state, .. }) if state == "connected")
    }
    fn disconnect(&self, vault: &str) -> Result<PairingStatus> {
        let _guard = self
            .gate
            .lock()
            .map_err(|_| "Pairing lifecycle unavailable")?;
        let Some(pending) = load_pending(self.store, vault)? else {
            return Ok(pairing_status("disconnected", vault, None, None));
        };
        if !self.transport.revoke(&pending)? {
            return Err("Revocation outcome is unknown; local credentials were retained".into());
        }
        self.store
            .remove(vault)
            .map_err(|_| "Server revoked access, but local keyring removal is unknown")?;
        self.store
            .remove(&pending_key(vault))
            .map_err(|_| "Server revoked access; pending keyring cleanup is unknown")?;
        Ok(pairing_status("disconnected", vault, None, None))
    }
}
fn production<T>(
    action: impl FnOnce(PairingCore<'_, KeyringStore, HttpsTransport>) -> Result<T>,
) -> Result<T> {
    let store = KeyringStore;
    let transport = HttpsTransport;
    action(PairingCore {
        store: &store,
        transport: &transport,
        gate: &PAIRING_LIFECYCLE,
    })
}
pub fn confirmed_active(vault: &str) -> bool {
    production(|core| Ok(core.confirmed_active(vault))).unwrap_or(false)
}

#[tauri::command]
pub async fn vault_pairing_prepare(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
) -> Result<PairingStatus> {
    let vault = state.with(&expected_vault_id, |v| Ok(v.id.clone()))?;
    tauri::async_runtime::spawn_blocking(move || production(|core| core.prepare(&vault)))
        .await
        .map_err(|_| "Pairing task failed")?
}
#[tauri::command]
pub async fn vault_pairing_claim(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
    invitation_id: String,
) -> Result<PairingStatus> {
    let vault = state.with(&expected_vault_id, |v| Ok(v.id.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        production(|core| core.claim(&vault, &invitation_id))
    })
    .await
    .map_err(|_| "Pairing task failed")?
}
#[tauri::command]
pub async fn vault_pairing_status(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
) -> Result<PairingStatus> {
    let vault = state.with(&expected_vault_id, |v| Ok(v.id.clone()))?;
    tauri::async_runtime::spawn_blocking(move || production(|core| core.status(&vault)))
        .await
        .map_err(|_| "Pairing task failed")?
}
#[tauri::command]
pub async fn vault_pairing_disconnect(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
) -> Result<PairingStatus> {
    let vault = state.with(&expected_vault_id, |v| Ok(v.id.clone()))?;
    tauri::async_runtime::spawn_blocking(move || production(|core| core.disconnect(&vault)))
        .await
        .map_err(|_| "Pairing task failed")?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        collections::BTreeMap,
        sync::{mpsc, Arc},
    };
    #[derive(Default)]
    struct MemoryStore(Mutex<BTreeMap<String, String>>);
    impl PairingStore for MemoryStore {
        fn load(&self, key: &str) -> Result<Option<String>> {
            Ok(self.0.lock().unwrap().get(key).cloned())
        }
        fn save(&self, key: &str, value: &str) -> Result<()> {
            self.0.lock().unwrap().insert(key.into(), value.into());
            Ok(())
        }
        fn remove(&self, key: &str) -> Result<()> {
            self.0.lock().unwrap().remove(key);
            Ok(())
        }
    }
    struct FailingStore {
        inner: MemoryStore,
        fail_load: bool,
        fail_save: bool,
        fail_remove: bool,
    }
    impl PairingStore for FailingStore {
        fn load(&self, key: &str) -> Result<Option<String>> {
            if self.fail_load {
                Err("synthetic keyring failure".into())
            } else {
                self.inner.load(key)
            }
        }
        fn save(&self, key: &str, value: &str) -> Result<()> {
            if self.fail_save {
                Err("synthetic keyring failure".into())
            } else {
                self.inner.save(key, value)
            }
        }
        fn remove(&self, key: &str) -> Result<()> {
            if self.fail_remove {
                Err("synthetic keyring failure".into())
            } else {
                self.inner.remove(key)
            }
        }
    }
    struct SyntheticTransport {
        bound: Bound,
        claim_error: Option<String>,
        status_error: Option<String>,
        revoke: Result<bool>,
        entered: Option<mpsc::Sender<()>>,
        release: Option<Mutex<mpsc::Receiver<()>>>,
    }
    impl PairingTransport for SyntheticTransport {
        fn claim(&self, _: &Pending, _: &Uuid) -> Result<()> {
            self.claim_error.clone().map_or(Ok(()), Err)
        }
        fn status(&self, _: &Pending) -> Result<Bound> {
            if let Some(entered) = &self.entered {
                entered.send(()).unwrap();
            }
            if let Some(release) = &self.release {
                release.lock().unwrap().recv().unwrap();
            }
            self.status_error
                .clone()
                .map_or(Ok(self.bound.clone()), Err)
        }
        fn revoke(&self, _: &Pending) -> Result<bool> {
            self.revoke.clone()
        }
    }
    fn vault() -> String {
        "00000000-0000-4000-8000-000000000002".into()
    }
    fn pending(vault: &str) -> Pending {
        Pending {
            device_id: "00000000-0000-4000-8000-000000000001".into(),
            vault_id: vault.into(),
            secret: "00".repeat(32),
            origin: "https://approved.example/".into(),
        }
    }
    fn transport(vault: &str) -> SyntheticTransport {
        SyntheticTransport {
            bound: Bound {
                device_id: pending(vault).device_id,
                vault_id: vault.into(),
                scope: "photo_inference".into(),
            },
            claim_error: None,
            status_error: None,
            revoke: Ok(true),
            entered: None,
            release: None,
        }
    }
    fn seed(store: &impl PairingStore, vault: &str) {
        store
            .save(
                &pending_key(vault),
                &serde_json::to_string(&pending(vault)).unwrap(),
            )
            .unwrap();
    }
    #[test]
    fn lost_claim_response_recovers_by_authenticated_status() {
        let vault = vault();
        let store = MemoryStore::default();
        seed(&store, &vault);
        let gate = Mutex::new(());
        let net = SyntheticTransport {
            claim_error: Some("lost response".into()),
            ..transport(&vault)
        };
        let core = PairingCore {
            store: &store,
            transport: &net,
            gate: &gate,
        };
        assert!(core.claim(&vault, &Uuid::new_v4().to_string()).is_err());
        assert_eq!(core.status(&vault).unwrap().state, "connected");
        assert!(store.load(&vault).unwrap().is_some());
    }
    #[test]
    fn status_rejects_device_vault_and_scope_mismatch_without_connection() {
        for changed in 0..3 {
            let vault = vault();
            let store = MemoryStore::default();
            seed(&store, &vault);
            let gate = Mutex::new(());
            let mut net = transport(&vault);
            if changed == 0 {
                net.bound.device_id = Uuid::new_v4().to_string();
            } else if changed == 1 {
                net.bound.vault_id = Uuid::new_v4().to_string();
            } else {
                net.bound.scope = "capture".into();
            }
            let core = PairingCore {
                store: &store,
                transport: &net,
                gate: &gate,
            };
            assert_eq!(core.status(&vault).unwrap().state, "unknown");
            assert!(store.load(&vault).unwrap().is_none());
        }
    }
    #[test]
    fn restart_status_recovers_existing_pending_connection() {
        let vault = vault();
        let store = MemoryStore::default();
        seed(&store, &vault);
        let gate = Mutex::new(());
        let net = transport(&vault);
        let core = PairingCore {
            store: &store,
            transport: &net,
            gate: &gate,
        };
        assert!(core.confirmed_active(&vault));
        drop(core);
        assert_eq!(
            PairingCore {
                store: &store,
                transport: &net,
                gate: &gate
            }
            .status(&vault)
            .unwrap()
            .state,
            "connected"
        );
    }
    #[test]
    fn keyring_failures_and_offline_disconnect_retention_are_unknown() {
        let vault = vault();
        let store = FailingStore {
            inner: MemoryStore::default(),
            fail_load: false,
            fail_save: true,
            fail_remove: false,
        };
        seed(&store.inner, &vault);
        let gate = Mutex::new(());
        let net = transport(&vault);
        assert_eq!(
            PairingCore {
                store: &store,
                transport: &net,
                gate: &gate
            }
            .status(&vault)
            .unwrap()
            .state,
            "unknown"
        );
        let unreadable = FailingStore {
            inner: MemoryStore::default(),
            fail_load: true,
            fail_save: false,
            fail_remove: false,
        };
        assert_eq!(
            PairingCore {
                store: &unreadable,
                transport: &net,
                gate: &gate
            }
            .status(&vault)
            .unwrap()
            .state,
            "unknown"
        );
        let store = MemoryStore::default();
        seed(&store, &vault);
        let net = SyntheticTransport {
            status_error: Some("offline".into()),
            ..transport(&vault)
        };
        assert_eq!(
            PairingCore {
                store: &store,
                transport: &net,
                gate: &gate
            }
            .status(&vault)
            .unwrap()
            .state,
            "unknown"
        );
        assert!(store.load(&pending_key(&vault)).unwrap().is_some());
    }
    #[test]
    fn offline_disconnect_retains_both_credentials_and_repeated_confirmation_is_safe() {
        let vault = vault();
        let store = MemoryStore::default();
        seed(&store, &vault);
        let gate = Mutex::new(());
        let online = transport(&vault);
        let core = PairingCore {
            store: &store,
            transport: &online,
            gate: &gate,
        };
        assert!(core.confirmed_active(&vault));
        assert!(core.confirmed_active(&vault));
        let offline = SyntheticTransport {
            revoke: Err("offline".into()),
            ..transport(&vault)
        };
        assert!(PairingCore {
            store: &store,
            transport: &offline,
            gate: &gate
        }
        .disconnect(&vault)
        .is_err());
        assert!(store.load(&vault).unwrap().is_some());
        assert!(store.load(&pending_key(&vault)).unwrap().is_some());
    }
    #[test]
    fn revoke_is_server_first_and_idempotent_but_keyring_removal_failure_is_unknown() {
        let vault = vault();
        let store = FailingStore {
            inner: MemoryStore::default(),
            fail_load: false,
            fail_save: false,
            fail_remove: true,
        };
        seed(&store.inner, &vault);
        let gate = Mutex::new(());
        let net = transport(&vault);
        assert!(PairingCore {
            store: &store,
            transport: &net,
            gate: &gate
        }
        .disconnect(&vault)
        .unwrap_err()
        .contains("Server revoked"));
        let store = MemoryStore::default();
        let net = transport(&vault);
        let core = PairingCore {
            store: &store,
            transport: &net,
            gate: &gate,
        };
        assert_eq!(core.disconnect(&vault).unwrap().state, "disconnected");
        assert_eq!(core.disconnect(&vault).unwrap().state, "disconnected");
    }
    #[test]
    fn late_status_cannot_restore_after_concurrent_disconnect() {
        let vault = vault();
        let store = Arc::new(MemoryStore::default());
        seed(&*store, &vault);
        let gate = Arc::new(Mutex::new(()));
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let net = Arc::new(SyntheticTransport {
            entered: Some(entered_tx),
            release: Some(Mutex::new(release_rx)),
            ..transport(&vault)
        });
        let a_store = store.clone();
        let a_net = net.clone();
        let a_gate = gate.clone();
        let a_vault = vault.clone();
        let status = std::thread::spawn(move || {
            PairingCore {
                store: &*a_store,
                transport: &*a_net,
                gate: &*a_gate,
            }
            .status(&a_vault)
        });
        entered_rx.recv().unwrap();
        let b_store = store.clone();
        let b_net = net.clone();
        let b_gate = gate.clone();
        let b_vault = vault.clone();
        let disconnect = std::thread::spawn(move || {
            PairingCore {
                store: &*b_store,
                transport: &*b_net,
                gate: &*b_gate,
            }
            .disconnect(&b_vault)
        });
        release_tx.send(()).unwrap();
        status.join().unwrap().unwrap();
        disconnect.join().unwrap().unwrap();
        assert!(store.load(&vault).unwrap().is_none());
        assert!(store.load(&pending_key(&vault)).unwrap().is_none());
    }
    #[test]
    fn fingerprint_is_sha256_of_secret_and_not_a_bearer() {
        let secret = "00".repeat(32);
        assert_eq!(fingerprint(&secret).len(), 64);
        assert_ne!(fingerprint(&secret), secret);
    }
    #[test]
    fn service_origin_rejects_unreviewed_build_by_default() {
        if option_env!("RECALL_PAIRING_ORIGIN").is_none() {
            assert!(configured_origin().is_err());
        }
    }
}
