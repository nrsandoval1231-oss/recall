mod local_vault;
mod managed_export;
mod persistence;
mod secrets;

use managed_export::ManagedExportState;
use persistence::{NativeStore, PendingCommand, Scope, Snapshot, SyncEvent};
use tauri::Manager;

pub struct NativeState(std::result::Result<NativeStore, String>);
impl NativeState {
    fn store(&self) -> Result<&NativeStore, String> {
        self.0.as_ref().map_err(Clone::clone)
    }
}

fn fail(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[tauri::command]
fn sync_apply_page(
    state: tauri::State<'_, NativeState>,
    scope: Scope,
    events: Vec<SyncEvent>,
    cursor: String,
) -> Result<(), String> {
    state
        .store()?
        .apply_page(&scope, &events, cursor)
        .map_err(fail)
}

#[tauri::command]
fn sync_replace_snapshot(
    state: tauri::State<'_, NativeState>,
    scope: Scope,
    snapshot: Snapshot,
) -> Result<(), String> {
    state
        .store()?
        .replace_snapshot(&scope, &snapshot)
        .map_err(fail)
}

#[tauri::command]
fn sync_cursor(state: tauri::State<'_, NativeState>, scope: Scope) -> Result<String, String> {
    state.store()?.cursor(&scope).map_err(fail)
}

#[tauri::command]
fn local_search(
    state: tauri::State<'_, NativeState>,
    scope: Scope,
    query: String,
    limit: u32,
) -> Result<Vec<persistence::CachedRecord>, String> {
    state.store()?.search(&scope, &query, limit).map_err(fail)
}

#[tauri::command]
fn cache_list_records(
    state: tauri::State<'_, NativeState>,
    scope: Scope,
    kind: Option<String>,
    limit: u32,
) -> Result<Vec<persistence::CachedRecord>, String> {
    state
        .store()?
        .records(&scope, kind.as_deref(), limit)
        .map_err(fail)
}

#[tauri::command]
fn cache_get_record(
    state: tauri::State<'_, NativeState>,
    scope: Scope,
    kind: String,
    record_id: String,
) -> Result<Option<persistence::CachedRecord>, String> {
    state
        .store()?
        .get_record(&scope, &kind, &record_id)
        .map_err(fail)
}

#[tauri::command]
fn cache_last_workspace(
    state: tauri::State<'_, NativeState>,
    user_id: String,
) -> Result<Option<String>, String> {
    state.store()?.last_workspace(&user_id).map_err(fail)
}

#[tauri::command]
fn outbox_enqueue(
    state: tauri::State<'_, NativeState>,
    scope: Scope,
    command: PendingCommand,
) -> Result<(), String> {
    state.store()?.enqueue(&scope, &command).map_err(fail)
}

#[tauri::command]
fn outbox_list(
    state: tauri::State<'_, NativeState>,
    scope: Scope,
) -> Result<Vec<PendingCommand>, String> {
    state.store()?.outbox(&scope).map_err(fail)
}

#[tauri::command]
fn outbox_mark(
    state: tauri::State<'_, NativeState>,
    scope: Scope,
    operation_id: String,
    state_name: String,
    error: Option<String>,
) -> Result<(), String> {
    state
        .store()?
        .mark_outbox(&scope, &operation_id, &state_name, error.as_deref())
        .map_err(fail)
}

#[tauri::command]
fn cache_clear(
    state: tauri::State<'_, NativeState>,
    scope: Scope,
    clear_outbox: Option<bool>,
) -> Result<(), String> {
    state
        .store()?
        .clear_cache(&scope, clear_outbox.unwrap_or(false))
        .map_err(fail)
}

#[tauri::command]
fn source_store_verified(
    state: tauri::State<'_, NativeState>,
    scope: Scope,
    source_id: String,
    expected_sha256: String,
    bytes: Vec<u8>,
) -> Result<persistence::SourceInventory, String> {
    state
        .store()?
        .store_source(&scope, &source_id, &expected_sha256, &bytes)
        .map_err(fail)
}

#[tauri::command]
fn source_get_verified(
    state: tauri::State<'_, NativeState>,
    scope: Scope,
    source_id: String,
) -> Result<Option<persistence::SourceInventory>, String> {
    state.store()?.get_source(&scope, &source_id).map_err(fail)
}

#[tauri::command]
fn export_select_markdown_root(
    state: tauri::State<'_, ManagedExportState>,
) -> Result<Option<String>, String> {
    state.select_markdown_root().map_err(fail)
}

#[tauri::command]
fn export_save_archive(
    state: tauri::State<'_, ManagedExportState>,
    bytes: Vec<u8>,
    expected_sha256: String,
) -> Result<Option<managed_export::ArchiveSaveResult>, String> {
    state.save_archive(&bytes, &expected_sha256).map_err(fail)
}

#[tauri::command]
fn export_apply_markdown_archive(
    state: tauri::State<'_, ManagedExportState>,
    bytes: Vec<u8>,
    expected_sha256: String,
) -> Result<managed_export::ManagedExportResult, String> {
    state
        .apply_markdown_archive(&bytes, &expected_sha256)
        .map_err(fail)
}

#[tauri::command]
fn vault_status(
    state: tauri::State<'_, local_vault::LocalVaultState>,
) -> Result<local_vault::VaultStatus, String> {
    state.status()
}
#[tauri::command]
fn vault_select(
    state: tauri::State<'_, local_vault::LocalVaultState>,
) -> Result<Option<local_vault::VaultStatus>, String> {
    let Some(root) = rfd::FileDialog::new()
        .set_title("Choose your Obsidian vault folder")
        .pick_folder()
    else {
        return Ok(None);
    };
    state.select_path(&root).map(Some)
}
#[tauri::command]
fn vault_capture(
    state: tauri::State<'_, local_vault::LocalVaultState>,
    expected_vault_id: String,
    operation_id: String,
    note: String,
) -> Result<Option<local_vault::VaultMemory>, String> {
    state.with(&expected_vault_id, |vault| {
        if let Some(saved) = vault.capture_receipt(&operation_id, &note)? {
            return Ok(Some(saved));
        }
        let Some(path) = rfd::FileDialog::new()
            .set_title("Import an original photo")
            .add_filter("Photos", &["png", "jpg", "jpeg", "webp"])
            .pick_file()
        else {
            return Ok(None);
        };
        vault.capture_path(&operation_id, &note, &path).map(Some)
    })
}
#[tauri::command]
fn vault_list(
    state: tauri::State<'_, local_vault::LocalVaultState>,
    expected_vault_id: String,
    query: String,
    include_deleted: Option<bool>,
) -> Result<Vec<local_vault::VaultMemory>, String> {
    state.with(&expected_vault_id, |vault| {
        vault.list_with_deleted(&query, include_deleted.unwrap_or(false))
    })
}
#[tauri::command]
fn vault_correct(
    state: tauri::State<'_, local_vault::LocalVaultState>,
    expected_vault_id: String,
    memory_id: String,
    expected_revision: u64,
    operation_id: String,
    note: String,
) -> Result<local_vault::VaultMemory, String> {
    state.with(&expected_vault_id, |vault| {
        vault.correct(&memory_id, expected_revision, &operation_id, &note)
    })
}
#[tauri::command]
fn vault_restore_note(
    state: tauri::State<'_, local_vault::LocalVaultState>,
    expected_vault_id: String,
    memory_id: String,
    expected_revision: u64,
    operation_id: String,
) -> Result<local_vault::VaultMemory, String> {
    state.with(&expected_vault_id, |vault| {
        vault.restore_note(&memory_id, expected_revision, &operation_id)
    })
}
#[tauri::command]
fn vault_remove(
    state: tauri::State<'_, local_vault::LocalVaultState>,
    expected_vault_id: String,
    memory_id: String,
    expected_revision: u64,
    operation_id: String,
    expected_state: String,
) -> Result<local_vault::VaultMemory, String> {
    state.with(&expected_vault_id, |vault| {
        vault.remove(
            &memory_id,
            expected_revision,
            &operation_id,
            &expected_state,
        )
    })
}
#[tauri::command]
fn vault_rebuild(
    state: tauri::State<'_, local_vault::LocalVaultState>,
    expected_vault_id: String,
    include_deleted: Option<bool>,
) -> Result<Vec<local_vault::VaultMemory>, String> {
    state.with(&expected_vault_id, |vault| {
        vault.list_with_deleted("", include_deleted.unwrap_or(false))
    })
}
#[tauri::command]
fn vault_source(
    state: tauri::State<'_, local_vault::LocalVaultState>,
    expected_vault_id: String,
    memory_id: String,
) -> Result<local_vault::VaultSource, String> {
    state.with(&expected_vault_id, |vault| vault.source(&memory_id))
}
#[tauri::command]
fn vault_history(
    state: tauri::State<'_, local_vault::LocalVaultState>,
    expected_vault_id: String,
    memory_id: String,
) -> Result<Vec<local_vault::VaultRevision>, String> {
    state.with(&expected_vault_id, |vault| vault.history(&memory_id))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app data directory unavailable");
            std::fs::create_dir_all(&data_dir).expect("cannot create app data directory");
            // A corrupt legacy cloud cache must not prevent the local-only vault UI.
            let store =
                NativeStore::open(data_dir.join("recall.sqlite3"), data_dir.join("sources"))
                    .map_err(fail);
            app.manage(local_vault::LocalVaultState::new(
                data_dir.join("selected-vault.json"),
            ));
            app.manage(NativeState(store));
            app.manage(ManagedExportState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault_status,
            vault_select,
            vault_capture,
            vault_list,
            vault_correct,
            vault_restore_note,
            vault_remove,
            vault_rebuild,
            vault_source,
            vault_history,
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_remove,
            sync_apply_page,
            sync_replace_snapshot,
            sync_cursor,
            local_search,
            cache_list_records,
            cache_get_record,
            cache_last_workspace,
            outbox_enqueue,
            outbox_list,
            outbox_mark,
            cache_clear,
            source_store_verified,
            source_get_verified,
            export_select_markdown_root,
            export_save_archive,
            export_apply_markdown_archive
        ])
        .run(tauri::generate_context!())
        .expect("error while running Recall");
}
