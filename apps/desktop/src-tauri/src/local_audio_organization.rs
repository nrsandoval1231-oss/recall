//! Separate, remembered, revocable consent to organize voice-note transcripts, and the
//! dispatch of audio intents. Only the bounded transcript text of recordings captured
//! after the decision is ever sent; the recording is never uploaded. Text/photo
//! consent never enrolls audio and audio consent never enrolls text/photo.
use crate::{
    local_organization::{
        requested_decision_proven, LocalOrganizationTransport, NativeOrganizationCapability,
        OrganizationCapability, OrganizationLookup, OrganizationMarker, OrganizationOperation,
        OrganizationReceipt, OrganizationRequest,
    },
    local_vault::{AudioOrganizationIntent, LocalVaultState, SelectionGuard, Vault},
    pairing::{self, IntelligenceConnection},
};
use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
};
use tauri::State;
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;
const SWEEP_LIMIT: usize = 50;

fn native_audio_capability(
    vault: &Vault,
    connection: &IntelligenceConnection,
    server: OrganizationCapability,
) -> NativeOrganizationCapability {
    let local_readiness = match vault.audio_organization_marker() {
        Ok(Some(marker))
            if server.consent == "active"
                && marker.vault_id == vault.id
                && marker.policy_version == server.policy_version
                && marker.consent_epoch == server.consent_epoch
                && marker.connection_fingerprint == connection.fingerprint =>
        {
            "ready"
        }
        Ok(Some(_)) if matches!(server.consent.as_str(), "missing" | "outdated") => "unknown",
        Ok(Some(_)) => "needs_setup",
        Ok(None) if server.consent == "active" => "needs_setup",
        Ok(None) => "off",
        Err(_) => "unknown",
    }
    .to_string();
    NativeOrganizationCapability {
        automatic_enabled: server.enabled && local_readiness == "ready",
        server,
        local_readiness,
    }
}

fn audio_marker(
    vault: &Vault,
    server: &OrganizationCapability,
    connection: &IntelligenceConnection,
) -> OrganizationMarker {
    OrganizationMarker {
        schema_version: "1.0".into(),
        vault_id: vault.id.clone(),
        policy_version: server.policy_version.clone(),
        consent_epoch: server.consent_epoch,
        local_epoch: Uuid::new_v4().to_string(),
        connection_fingerprint: connection.fingerprint.clone(),
    }
}

/// Commit a server-confirmed decision locally. Enabling writes the future-capture
/// marker only while the paired connection is unchanged; disabling clears it.
pub(crate) fn commit_confirmed_audio_consent(
    vault: &Vault,
    expected_connection: &IntelligenceConnection,
    current_connection: Option<&IntelligenceConnection>,
    server: OrganizationCapability,
    enabled: bool,
) -> Result<NativeOrganizationCapability> {
    if vault.id != expected_connection.vault_id || server.vault_id != vault.id {
        return Err("Audio organization consent does not match the selected vault".into());
    }
    if enabled {
        let Some(connection) = current_connection.filter(|current| {
            current.vault_id == vault.id && current.fingerprint == expected_connection.fingerprint
        }) else {
            return Ok(NativeOrganizationCapability {
                server,
                local_readiness: "unknown".into(),
                automatic_enabled: false,
            });
        };
        if server.consent == "active" {
            // A failed local commit leaves needs_setup/unknown; it never turns on the fence.
            let _ =
                vault.set_audio_organization_marker(Some(audio_marker(vault, &server, connection)));
        }
    } else {
        vault.set_audio_organization_marker(None)?;
    }
    Ok(native_audio_capability(vault, expected_connection, server))
}

#[tauri::command]
pub async fn vault_audio_organization_capability(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
) -> Result<NativeOrganizationCapability> {
    let vault_id = state.with(&expected_vault_id, |v| Ok(v.id.clone()))?;
    let connection =
        tauri::async_runtime::spawn_blocking(move || pairing::confirmed_intelligence(&vault_id))
            .await
            .map_err(|_| "Audio organization connection failed")??;
    let c = connection.clone();
    let cap = tauri::async_runtime::spawn_blocking(move || {
        LocalOrganizationTransport::new(c)?.audio_capability()
    })
    .await
    .map_err(|_| "Audio organization capability failed")??;
    state.with(&expected_vault_id, |v| {
        if v.id == connection.vault_id {
            Ok(native_audio_capability(v, &connection, cap))
        } else {
            Err("Vault selection changed".into())
        }
    })
}

#[tauri::command]
pub async fn vault_set_audio_organization_consent(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
    enabled: bool,
    expected_consent_epoch: u64,
) -> Result<NativeOrganizationCapability> {
    let vault_id = state.with(&expected_vault_id, |v| Ok(v.id.clone()))?;
    let connection =
        tauri::async_runtime::spawn_blocking(move || pairing::confirmed_intelligence(&vault_id))
            .await
            .map_err(|_| "Audio organization connection failed")??;
    let c = connection.clone();
    let cap = tauri::async_runtime::spawn_blocking(move || -> Result<OrganizationCapability> {
        let t = LocalOrganizationTransport::new(c)?;
        let before = t.audio_capability()?;
        if before.consent_epoch != expected_consent_epoch {
            return Err("Audio organization consent changed; refresh capability".into());
        }
        let after = t.set_audio_consent(&before, enabled)?;
        if !requested_decision_proven(&before, &after, enabled) {
            return Err("Audio organization consent outcome is unknown; refresh capability".into());
        }
        Ok(after)
    })
    .await
    .map_err(|_| "Audio organization consent failed")??;
    state.with(&expected_vault_id, |v| {
        if v.id != connection.vault_id {
            return Err("Vault selection changed".into());
        }
        if enabled {
            // Re-read the protected pairing after the server decision: re-pairing during
            // the request invalidates this local future-capture fence.
            return match pairing::confirmed_intelligence(&v.id) {
                Ok(current) if current.fingerprint == connection.fingerprint => {
                    commit_confirmed_audio_consent(v, &connection, Some(&current), cap, true)
                }
                _ => commit_confirmed_audio_consent(v, &connection, None, cap, true),
            };
        }
        commit_confirmed_audio_consent(v, &connection, None, cap, false)
    })
}

#[tauri::command]
pub async fn vault_reconcile_audio_organization_consent(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
) -> Result<NativeOrganizationCapability> {
    let guard = state.session(&expected_vault_id)?;
    let vault_id = guard.vault.id.clone();
    let connection =
        tauri::async_runtime::spawn_blocking(move || pairing::confirmed_intelligence(&vault_id))
            .await
            .map_err(|_| "Audio organization connection failed")??;
    let c = connection.clone();
    let cap = tauri::async_runtime::spawn_blocking(move || {
        LocalOrganizationTransport::new(c)?.audio_capability()
    })
    .await
    .map_err(|_| "Audio organization capability failed")??;
    guard.with(|v| {
        if v.id != connection.vault_id || cap.vault_id != v.id {
            return Err("Vault selection changed".into());
        }
        if cap.consent == "active" {
            v.set_audio_organization_marker(Some(audio_marker(v, &cap, &connection)))?;
        } else if matches!(cap.consent.as_str(), "missing" | "outdated") {
            v.set_audio_organization_marker(None)?;
        }
        Ok(native_audio_capability(v, &connection, cap))
    })
}

#[tauri::command]
pub fn vault_audio_organization_operations(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
    memory_id: String,
) -> Result<Vec<OrganizationOperation>> {
    state.with(&expected_vault_id, |v| {
        v.audio_organization_operations(&memory_id)
    })
}

#[tauri::command]
pub async fn vault_recover_audio_organization(
    state: State<'_, LocalVaultState>,
    expected_vault_id: String,
    operation_id: String,
) -> Result<OrganizationOperation> {
    let guard = state.session(&expected_vault_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let gate = PROCESS_GATE.get_or_init(|| Mutex::new(()));
        let _gate = gate
            .lock()
            .map_err(|_| "Audio organization runner unavailable")?;
        let _ = run_production(&guard, Some(&operation_id));
        guard.with(|vault| vault.audio_organization_operation(&operation_id))
    })
    .await
    .map_err(|_| "Audio organization recovery failed")?
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/// The remote surface audio dispatch needs. The production implementation is the fixed
/// HTTPS transport; tests inject a fake and never touch the network.
pub trait AudioOrganizationTransport {
    fn capability(&self) -> Result<OrganizationCapability>;
    fn get(&self, request: &OrganizationRequest) -> Result<OrganizationLookup>;
    fn post(&self, request: &OrganizationRequest, body: Vec<u8>) -> Result<OrganizationReceipt>;
}
struct HttpsAudioTransport(LocalOrganizationTransport);
impl AudioOrganizationTransport for HttpsAudioTransport {
    fn capability(&self) -> Result<OrganizationCapability> {
        self.0.audio_capability()
    }
    fn get(&self, request: &OrganizationRequest) -> Result<OrganizationLookup> {
        self.0.get(request)
    }
    fn post(&self, request: &OrganizationRequest, body: Vec<u8>) -> Result<OrganizationReceipt> {
        self.0.post(request, body)
    }
}

static PROCESS_GATE: OnceLock<Mutex<()>> = OnceLock::new();

/// Drain eligible work in the background. No-op without an audio marker.
pub fn schedule_pending(guard: SelectionGuard) {
    let _ = std::thread::Builder::new()
        .name("monolith-audio-organize".into())
        .spawn(move || {
            let gate = PROCESS_GATE.get_or_init(|| Mutex::new(()));
            if let Ok(_gate) = gate.lock() {
                let _ = run_production(&guard, None);
            }
        });
}

fn run_production(guard: &SelectionGuard, operation_id: Option<&str>) -> Result<bool> {
    guard.active()?;
    if guard.vault.audio_organization_marker()?.is_none() {
        return Ok(false);
    }
    guard.vault.audio_organization_requeue_pending()?;
    let vault_id = guard.vault.id.clone();
    let connection = pairing::confirmed_intelligence(&vault_id)?;
    let transport = HttpsAudioTransport(LocalOrganizationTransport::new(connection)?);
    run_audio_scoped(
        guard,
        operation_id,
        &mut HashSet::new(),
        &|| Ok(pairing::confirmed_intelligence(&vault_id)?.fingerprint),
        &transport,
    )
}

fn capability_current(
    capability: &OrganizationCapability,
    vault: &Vault,
    marker: &OrganizationMarker,
) -> bool {
    capability.enabled
        && capability.consent == "active"
        && capability.vault_id == vault.id
        && capability.policy_version == marker.policy_version
        && capability.consent_epoch == marker.consent_epoch
}

/// Process queued/processing/unknown audio intents (one named intent, or a bounded
/// sweep). `current_fingerprint` re-reads the protected pairing each time it is needed.
pub(crate) fn run_audio_scoped<T: AudioOrganizationTransport>(
    guard: &SelectionGuard,
    operation_id: Option<&str>,
    attempted: &mut HashSet<String>,
    current_fingerprint: &dyn Fn() -> Result<String>,
    transport: &T,
) -> Result<bool> {
    guard.active()?;
    let vault = &guard.vault;
    let Some(marker) = vault.audio_organization_marker()? else {
        return Ok(false);
    };
    // Queue recordings whose transcript committed but whose queue step never completed.
    vault.audio_organization_requeue_pending()?;
    let fingerprint = current_fingerprint()?;
    if fingerprint != marker.connection_fingerprint {
        return Ok(false);
    }
    let mut processed = 0;
    while processed < SWEEP_LIMIT {
        guard.active()?;
        let Some(current_marker) = vault.audio_organization_marker()? else {
            return Ok(false);
        };
        if current_marker != marker || current_fingerprint()? != fingerprint {
            return Ok(false);
        }
        let capability = transport.capability()?;
        if !capability_current(&capability, vault, &marker) {
            return Ok(false);
        }
        let mut work: Vec<AudioOrganizationIntent> = vault
            .audio_organization_intents()?
            .into_iter()
            .filter(|i| {
                ["queued", "processing", "unknown"].contains(&i.state.as_str())
                    && operation_id.is_none_or(|op| i.operation_id == op)
                    && !attempted.contains(&i.operation_id)
            })
            .collect();
        // Fresh work first; ambiguous (unknown) attempts are visited once per sweep.
        work.sort_by_key(|i| match i.state.as_str() {
            "queued" => 0,
            "processing" => 1,
            _ => 2,
        });
        let Some(intent) = work.into_iter().next() else {
            return Ok(false);
        };
        attempted.insert(intent.operation_id.clone());
        process_audio_intent(
            guard,
            vault,
            &intent,
            &marker,
            &fingerprint,
            current_fingerprint,
            transport,
        )?;
        processed += 1;
        if operation_id.is_some() {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Why a pre-send re-check failed. `Stale` retires the operation with a code; `Transient`
/// means nothing is wrong with the operation itself (service off, network, vault busy), so an
/// unsent request simply goes back to `queued`.
enum Recheck {
    Stale(String),
    Transient,
}
enum DispatchFailure {
    Stale(String),
    /// Nothing was sent (the durable "sent" marker was not written).
    NotSent,
    /// The POST itself failed after the "sent" marker: the outcome is ambiguous.
    Ambiguous,
}
enum Attempt {
    Receipt(OrganizationReceipt),
    Stale(String),
    Transient,
    LookupFailed,
    Ambiguous,
}

/// Receipt first; only an authenticated "not found" may lead to a (re-checked) send.
/// Typed outcomes keep "stale before dispatch" apart from real transport errors.
fn audio_recover_then_dispatch(
    lookup: Result<OrganizationLookup>,
    expected: &OrganizationRequest,
    recheck: impl FnOnce() -> std::result::Result<(OrganizationRequest, Vec<u8>), Recheck>,
    dispatch: impl FnOnce(
        &OrganizationRequest,
        Vec<u8>,
    ) -> std::result::Result<OrganizationReceipt, DispatchFailure>,
) -> Attempt {
    match lookup {
        Err(_) => Attempt::LookupFailed,
        Ok(OrganizationLookup::Receipt(receipt)) => Attempt::Receipt(receipt),
        Ok(OrganizationLookup::NotFound) => {
            let (request, body) = match recheck() {
                Ok(fresh) => fresh,
                Err(Recheck::Stale(code)) => return Attempt::Stale(code),
                Err(Recheck::Transient) => return Attempt::Transient,
            };
            if &request != expected || request.validate(&body).is_err() {
                return Attempt::Stale("REQUEST_CHANGED".into());
            }
            match dispatch(&request, body) {
                Ok(receipt) => Attempt::Receipt(receipt),
                Err(DispatchFailure::Stale(code)) => Attempt::Stale(code),
                Err(DispatchFailure::NotSent) => Attempt::Transient,
                Err(DispatchFailure::Ambiguous) => Attempt::Ambiguous,
            }
        }
    }
}

const LIVE: [&str; 3] = ["queued", "processing", "unknown"];
const IN_FLIGHT: [&str; 2] = ["processing", "unknown"];

fn process_audio_intent<T: AudioOrganizationTransport>(
    guard: &SelectionGuard,
    vault: &Vault,
    pending: &AudioOrganizationIntent,
    marker: &OrganizationMarker,
    fingerprint: &str,
    current_fingerprint: &dyn Fn() -> Result<String>,
    transport: &T,
) -> Result<()> {
    guard.active()?;
    let op = pending.operation_id.as_str();
    let Some((intent, request, body)) = vault.audio_organization_dispatch_material(op)? else {
        return Ok(());
    };
    if intent.connection_fingerprint != fingerprint {
        vault.transition_audio_organization_state(
            op,
            &LIVE,
            "stale",
            Some("CONNECTION_CHANGED"),
        )?;
        return Ok(());
    }
    let first_send = intent.state == "queued";
    if first_send
        && vault
            .transition_audio_organization_state(op, &["queued"], "processing", None)?
            .is_none()
    {
        // Retired between the material check and now (e.g. consent revoked): never send.
        return Ok(());
    }
    let fresh = |vault: &Vault| -> Result<Option<(OrganizationRequest, Vec<u8>)>> {
        let Some((again, fresh_request, fresh_body)) =
            vault.audio_organization_dispatch_material(op)?
        else {
            return Ok(None);
        };
        if again.connection_fingerprint != fingerprint
            || fresh_request != request
            || fresh_body != body
        {
            vault.transition_audio_organization_state(
                op,
                &LIVE,
                "stale",
                Some("SOURCE_OR_CONNECTION_CHANGED"),
            )?;
            return Ok(None);
        }
        Ok(Some((fresh_request, fresh_body)))
    };
    let attempt = audio_recover_then_dispatch(
        transport.get(&request),
        &request,
        || {
            guard.active().map_err(|_| Recheck::Transient)?;
            let now = current_fingerprint().map_err(|_| Recheck::Transient)?;
            if now != fingerprint {
                return Err(Recheck::Stale("CONNECTION_CHANGED".into()));
            }
            match vault.audio_organization_marker() {
                Ok(None) => return Err(Recheck::Stale("CONSENT_REVOKED".into())),
                Ok(Some(current)) if current != *marker => {
                    return Err(Recheck::Stale("CONSENT_EPOCH_CHANGED".into()));
                }
                Ok(Some(_)) => {}
                Err(_) => return Err(Recheck::Transient),
            }
            let capability = transport.capability().map_err(|_| Recheck::Transient)?;
            if capability.consent != "active"
                || capability.policy_version != marker.policy_version
                || capability.consent_epoch != marker.consent_epoch
            {
                return Err(Recheck::Stale("CONSENT_CHANGED".into()));
            }
            if !capability_current(&capability, vault, marker) {
                // Consent is unchanged but the service is switched off right now.
                return Err(Recheck::Transient);
            }
            match fresh(vault) {
                Ok(Some(material)) => Ok(material),
                Ok(None) => Err(Recheck::Stale("SOURCE_OR_CONNECTION_CHANGED".into())),
                Err(_) => Err(Recheck::Transient),
            }
        },
        |fresh_request, fresh_body| {
            guard.active().map_err(|_| DispatchFailure::NotSent)?;
            // Durable marker first: from here on a failure is ambiguous, never "not sent".
            match vault.mark_audio_organization_sent(op) {
                Ok(true) => {}
                Ok(false) => return Err(DispatchFailure::Stale("STATE_CHANGED".into())),
                Err(_) => return Err(DispatchFailure::NotSent),
            }
            transport
                .post(fresh_request, fresh_body)
                .map_err(|_| DispatchFailure::Ambiguous)
        },
    );
    let receipt = match attempt {
        Attempt::Receipt(receipt) => receipt,
        Attempt::Stale(code) => {
            vault.transition_audio_organization_state(op, &LIVE, "stale", Some(&code))?;
            return Ok(());
        }
        Attempt::Transient => {
            vault.revert_audio_organization_unsent(op)?;
            return Ok(());
        }
        Attempt::LookupFailed => {
            let code = if first_send {
                "NOT_DISPATCHED"
            } else {
                "RECEIPT_UNAVAILABLE"
            };
            vault.transition_audio_organization_state(op, &LIVE, "unknown", Some(code))?;
            return Ok(());
        }
        Attempt::Ambiguous => {
            vault.transition_audio_organization_state(
                op,
                &IN_FLIGHT,
                "unknown",
                Some("RECEIPT_UNAVAILABLE"),
            )?;
            return Ok(());
        }
    };
    // A receipt that fails validation never aborts the sweep and is never re-sent: the
    // service holds a record for this operation, so it stays ambiguous with a safe code.
    if receipt.validate(&request, Some(&body)).is_err() {
        vault.transition_audio_organization_state(
            op,
            &IN_FLIGHT,
            "unknown",
            Some("RECEIPT_INVALID"),
        )?;
        return Ok(());
    }
    match receipt.state.as_str() {
        "complete" => {
            let verdict = (|| -> Result<bool> {
                let latest = transport.capability()?;
                let now_fingerprint = current_fingerprint()?;
                let current_marker = vault.audio_organization_marker()?;
                let still_fresh = fresh(vault)?;
                Ok(guard.active().is_ok()
                    && now_fingerprint == fingerprint
                    && current_marker.as_ref() == Some(marker)
                    && still_fresh.is_some()
                    && capability_current(&latest, vault, marker))
            })();
            match verdict {
                Err(_) => {
                    vault.transition_audio_organization_state(
                        op,
                        &IN_FLIGHT,
                        "unknown",
                        Some("RECEIPT_UNAVAILABLE"),
                    )?;
                }
                Ok(false) => {
                    vault.transition_audio_organization_state(
                        op,
                        &IN_FLIGHT,
                        "stale",
                        Some("CONSENT_CHANGED"),
                    )?;
                }
                Ok(true) => {
                    // The selection mutex is held only for the validated journal promotion,
                    // making the last session check and the commit indivisible.
                    let promoted = guard.with(|current_vault| {
                        if current_vault.audio_organization_marker()?.as_ref() != Some(marker) {
                            return Err("Vault selection changed".into());
                        }
                        current_vault
                            .promote_audio_organization(&request, &body, &receipt)
                            .map(|_| ())
                    });
                    if promoted.is_err() {
                        vault.transition_audio_organization_state(
                            op,
                            &IN_FLIGHT,
                            "unknown",
                            Some("PROMOTION_FAILED"),
                        )?;
                    }
                }
            }
        }
        "failed" | "expired" => {
            vault.transition_audio_organization_state(
                op,
                &IN_FLIGHT,
                "failed",
                receipt.error_code.as_deref(),
            )?;
        }
        _ => {
            vault.transition_audio_organization_state(
                op,
                &IN_FLIGHT,
                "unknown",
                receipt.error_code.as_deref(),
            )?;
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "local_audio_organization_tests.rs"]
pub(crate) mod tests;
