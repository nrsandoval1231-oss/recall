mod managed_export;
mod persistence;
mod secrets;

use managed_export::ManagedExportState;
use persistence::{NativeStore, PendingCommand, Scope, Snapshot, SyncEvent};
use tauri::Manager;

pub struct NativeState(pub NativeStore);

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
    state.0.apply_page(&scope, &events, cursor).map_err(fail)
}

#[tauri::command]
fn sync_replace_snapshot(
    state: tauri::State<'_, NativeState>,
    scope: Scope,
    snapshot: Snapshot,
) -> Result<(), String> {
    state.0.replace_snapshot(&scope, &snapshot).map_err(fail)
}

#[tauri::command]
fn sync_cursor(state: tauri::State<'_, NativeState>, scope: Scope) -> Result<String, String> {
    state.0.cursor(&scope).map_err(fail)
}

#[tauri::command]
fn local_search(
    state: tauri::State<'_, NativeState>,
    scope: Scope,
    query: String,
    limit: u32,
) -> Result<Vec<persistence::CachedRecord>, String> {
    state.0.search(&scope, &query, limit).map_err(fail)
}

#[tauri::command]
fn cache_list_records(
    state: tauri::State<'_, NativeState>,
    scope: Scope,
    kind: Option<String>,
    limit: u32,
) -> Result<Vec<persistence::CachedRecord>, String> {
    state
        .0
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
    state.0.get_record(&scope, &kind, &record_id).map_err(fail)
}

#[tauri::command]
fn cache_last_workspace(
    state: tauri::State<'_, NativeState>,
    user_id: String,
) -> Result<Option<String>, String> {
    state.0.last_workspace(&user_id).map_err(fail)
}

#[tauri::command]
fn outbox_enqueue(
    state: tauri::State<'_, NativeState>,
    scope: Scope,
    command: PendingCommand,
) -> Result<(), String> {
    state.0.enqueue(&scope, &command).map_err(fail)
}

#[tauri::command]
fn outbox_list(
    state: tauri::State<'_, NativeState>,
    scope: Scope,
) -> Result<Vec<PendingCommand>, String> {
    state.0.outbox(&scope).map_err(fail)
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
        .0
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
        .0
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
        .0
        .store_source(&scope, &source_id, &expected_sha256, &bytes)
        .map_err(fail)
}

#[tauri::command]
fn source_get_verified(
    state: tauri::State<'_, NativeState>,
    scope: Scope,
    source_id: String,
) -> Result<Option<persistence::SourceInventory>, String> {
    state.0.get_source(&scope, &source_id).map_err(fail)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app data directory unavailable");
            std::fs::create_dir_all(&data_dir).expect("cannot create app data directory");
            let store =
                NativeStore::open(data_dir.join("recall.sqlite3"), data_dir.join("sources"))
                    .expect("cannot open local persistence");
            app.manage(NativeState(store));
            app.manage(ManagedExportState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
