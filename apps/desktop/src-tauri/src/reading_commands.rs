//! Tauri composition: short scoped filesystem phases surround native blocking HTTP.
use crate::{
    local_vault::{LocalVaultState, ReadingOperation, VaultMemory},
    reading::ReadingRequest,
    reading_transport::{ProtectedConnection, ReadingTransport},
};
use serde::Serialize;
#[derive(Serialize)]
pub struct ReadingCapability {
    enabled: bool,
    explanation: String,
}
#[derive(Serialize)]
pub struct ReadingOutcome {
    operation: ReadingOperation,
    memory: Option<VaultMemory>,
}
#[tauri::command]
pub fn vault_reading_capability(
    state: tauri::State<'_, LocalVaultState>,
    expected_vault_id: String,
) -> Result<ReadingCapability, String> {
    state.with(&expected_vault_id,|v| {
        let enabled=ProtectedConnection::read(&v.id).ok().flatten().is_some();
        Ok(ReadingCapability {enabled,explanation:if enabled {"Read this selected photo with Claude. The photo is sent to your connected private service."} else {"Claude photo reading is not connected. Your local originals, notes and search remain available."}.into()})
    })
}
#[tauri::command]
pub fn vault_reading_operations(
    state: tauri::State<'_, LocalVaultState>,
    expected_vault_id: String,
    memory_id: String,
) -> Result<Vec<ReadingOperation>, String> {
    state.with(&expected_vault_id, |v| v.reading_operations(&memory_id))
}
#[tauri::command]
pub fn vault_cancel_reading(
    state: tauri::State<'_, LocalVaultState>,
    expected_vault_id: String,
    operation_id: String,
) -> Result<ReadingOperation, String> {
    state.cancel_session_reading(&expected_vault_id, &operation_id)
}
#[tauri::command]
pub fn vault_correct_reading(
    state: tauri::State<'_, LocalVaultState>,
    expected_vault_id: String,
    memory_id: String,
    expected_revision: u64,
    operation_id: String,
    text: String,
) -> Result<VaultMemory, String> {
    state.with(&expected_vault_id, |v| {
        v.correct_reading(&memory_id, expected_revision, &operation_id, &text)
    })
}
#[tauri::command]
pub async fn vault_read_photo(
    state: tauri::State<'_, LocalVaultState>,
    expected_vault_id: String,
    memory_id: String,
    expected_revision: u64,
    operation_id: String,
) -> Result<ReadingOutcome, String> {
    // Fail closed before creating intent if this device has no existing connection.
    state.with(&expected_vault_id, |v| {
        ProtectedConnection::read(&v.id)?.ok_or("Claude photo reading is not connected".into())
    })?;
    let (vault, request) = state.begin_reading(
        &expected_vault_id,
        &memory_id,
        expected_revision,
        &operation_id,
    )?;
    run(&state, &expected_vault_id, vault, request, false).await
}
#[tauri::command]
pub async fn vault_recover_reading(
    state: tauri::State<'_, LocalVaultState>,
    expected_vault_id: String,
    operation_id: String,
) -> Result<ReadingOutcome, String> {
    let (vault, request) = state.resume_reading(&expected_vault_id, &operation_id)?;
    run(&state, &expected_vault_id, vault, request, true).await
}
async fn run(
    state: &LocalVaultState,
    session: &str,
    vault: crate::local_vault::Vault,
    request: ReadingRequest,
    recovery: bool,
) -> Result<ReadingOutcome, String> {
    let operation_id = request.binding.operation_id.clone();
    let response = if let Some(saved) = vault.reading_saved_result(&operation_id)? {
        saved
    } else {
        let (connection, bytes) = state.with(session, |v| {
            let connection =
                ProtectedConnection::read(&v.id)?.ok_or("Claude photo reading is not connected")?;
            let bytes = if recovery {
                v.reading_recovery_check(&request)?;
                None
            } else {
                v.reading_dispatch(&request)?
            };
            Ok((connection, bytes))
        })?;
        let req = request.clone();
        let response = tauri::async_runtime::spawn_blocking(move || {
            ReadingTransport::new(connection)?.send(&req, bytes)
        })
        .await
        .map_err(|_| "Photo reading transport interrupted")??;
        // Retain a bounded receipt in the original vault even if the selected session changed.
        // Cancellation is checked independently before any journal promotion.
        vault.retain_reading_response(&request, &response)?;
        response
    };
    let outcome = state.with(session, |v| {
        let memory = if response.state == "complete" {
            Some(v.accept_reading(&request, &response)?)
        } else {
            None
        };
        let operation = v
            .reading_operations(&request.binding.memory_id)?
            .into_iter()
            .find(|o| o.operation_id == operation_id)
            .ok_or("Reading operation unavailable")?;
        Ok(ReadingOutcome { operation, memory })
    })?;
    if outcome.operation.state == "committed" {
        state.forget_reading_session(session, &operation_id)?;
    }
    Ok(outcome)
}
