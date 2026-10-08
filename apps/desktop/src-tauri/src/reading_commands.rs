//! Tauri composition: short scoped filesystem phases surround native blocking HTTP.
use crate::{
    local_vault::{LocalVaultState, ReadingOperation, VaultMemory},
    reading::{ReadingReceipt, ReadingRequest},
    reading_transport::{ProtectedConnection, ReadingTransport, ServiceResponse},
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
        let response = fetch_reading(
            state,
            session,
            &request,
            recovery,
            |vault_id| {
                ProtectedConnection::read(vault_id)?
                    .ok_or("Claude photo reading is not connected".into())
            },
            ReadingTransport::new,
        )
        .await?;
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

// The production call supplies only the OS reader and HTTPS constructor. Tests
// inject loopback here to exercise the same retry orchestration over real TCP.
async fn fetch_reading(
    state: &LocalVaultState,
    session: &str,
    request: &ReadingRequest,
    recovery: bool,
    load: impl Fn(&str) -> Result<ProtectedConnection, String>,
    make: fn(ProtectedConnection) -> Result<ReadingTransport, String>,
) -> Result<ReadingReceipt, String> {
    let (connection, bytes, fingerprint) = state.with(session, |v| {
        let connection = load(&v.id)?;
        let fingerprint = connection.fingerprint();
        v.bind_reading_connection(request, &fingerprint)?;
        let bytes = if recovery {
            v.reading_recovery_check(request)?;
            None
        } else {
            v.reading_dispatch(request)?
        };
        Ok((connection, bytes, fingerprint))
    })?;
    let req = request.clone();
    let response =
        tauri::async_runtime::spawn_blocking(move || make(connection)?.send(&req, bytes))
            .await
            .map_err(|_| "Photo reading transport interrupted")??;
    match response {
        ServiceResponse::Receipt(receipt) => Ok(receipt),
        ServiceResponse::NotFound => {
            // This is one explicit retry gesture, not a retry loop. Re-read the
            // protected connection and revalidate session/source/cancel immediately
            // before resending identical operation/binding and preserved bytes.
            let (connection, bytes) = state.with(session, |v| {
                let connection = load(&v.id)?;
                if connection.fingerprint() != fingerprint {
                    return Err("Reading connection changed; operation was not resent".into());
                }
                let bytes = v.retry_reading_not_found(request, &fingerprint)?;
                Ok((connection, bytes))
            })?;
            let req = request.clone();
            match tauri::async_runtime::spawn_blocking(move || {
                make(connection)?.send(&req, Some(bytes))
            })
            .await
            .map_err(|_| "Photo reading transport interrupted")??
            {
                ServiceResponse::Receipt(receipt) => Ok(receipt),
                ServiceResponse::NotFound => Err("Photo reading request unavailable".into()),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        io::{Read, Write},
        net::TcpListener,
        sync::{Arc, Mutex},
        thread,
        time::{Duration, Instant},
    };
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!(
                "recall-synthetic-reading-http-{}",
                uuid::Uuid::new_v4()
            ));
            fs::create_dir(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn server(
        request: &ReadingRequest,
        first_state: &str,
    ) -> (String, thread::JoinHandle<Vec<Vec<u8>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        listener.set_nonblocking(true).unwrap();
        let request = request.clone();
        let first_state = first_state.to_string();
        let handle = thread::spawn(move || {
            let mut wires = vec![];
            let deadline = Instant::now() + Duration::from_secs(2);
            while Instant::now() < deadline {
                let (mut socket, _) = match listener.accept() {
                    Ok(v) => v,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    Err(e) => panic!("{e}"),
                };
                socket
                    .set_read_timeout(Some(Duration::from_secs(1)))
                    .unwrap();
                let mut wire = vec![];
                let mut buf = [0u8; 4096];
                loop {
                    let n = socket.read(&mut buf).unwrap();
                    if n == 0 {
                        break;
                    }
                    wire.extend_from_slice(&buf[..n]);
                    if let Some(end) = wire.windows(4).position(|w| w == b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&wire[..end]);
                        let size = head
                            .lines()
                            .find_map(|l| {
                                l.to_lowercase()
                                    .strip_prefix("content-length: ")
                                    .and_then(|s| s.parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        if wire.len() >= end + 4 + size {
                            break;
                        }
                    }
                }
                wires.push(wire);
                let (status, body) = if wires.len() == 1 && first_state == "not_found" {
                    (404, "{\"error\":{\"code\":\"NOT_FOUND\"}}".into())
                } else {
                    let state = if first_state == "not_found" {
                        "in_flight"
                    } else {
                        &first_state
                    };
                    (
                        if matches!(state, "in_flight" | "unknown") {
                            202
                        } else {
                            200
                        },
                        serde_json::to_string(&ReadingReceipt {
                            schema_version: "1.0".into(),
                            binding: request.binding.clone(),
                            state: state.into(),
                            result: None,
                            error_code: match state {
                                "unknown" => Some("PROVIDER_OUTCOME_UNKNOWN".into()),
                                "failed" => Some("PROVIDER_FAILED".into()),
                                "expired" => Some("RECEIPT_EXPIRED".into()),
                                _ => None,
                            },
                        })
                        .unwrap(),
                    )
                };
                socket.write_all(format!("HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).as_bytes()).unwrap();
                if wires.len() == 2 {
                    break;
                }
            }
            wires
        });
        (origin, handle)
    }
    #[test]
    fn reading_actual_get_not_found_reposts_exact_operation_after_restart() {
        let root = Fixture::new();
        let settings = root.0.join("selected.json");
        let state = LocalVaultState::new(settings.clone());
        let token = state.select_path(&root.0).unwrap().vault_id.unwrap();
        let photo = b"\x89PNG\r\n\x1a\nSYNTHETIC-ONLY".to_vec();
        let m = state
            .with(&token, |v| {
                v.capture(
                    &uuid::Uuid::new_v4().to_string(),
                    "synthetic.png",
                    &photo,
                    "base",
                )
            })
            .unwrap();
        let (vault, req) = state
            .begin_reading(&token, &m.id, 1, &uuid::Uuid::new_v4().to_string())
            .unwrap();
        let (origin, server) = server(&req, "not_found");
        let connection = ProtectedConnection::test_connection(
            &origin,
            &req.binding.vault_id,
            "synthetic-credential",
        );
        vault
            .bind_reading_connection(&req, &connection.fingerprint())
            .unwrap();
        vault.reading_dispatch(&req).unwrap();
        drop(state);
        let reopened = LocalVaultState::new(settings);
        let token = reopened.status().unwrap().vault_id.unwrap();
        let response = tauri::async_runtime::block_on(fetch_reading(
            &reopened,
            &token,
            &req,
            true,
            |_| Ok(connection.clone()),
            ReadingTransport::test_from_connection,
        ))
        .unwrap();
        assert_eq!(response.state, "in_flight");
        let wires = server.join().unwrap();
        assert_eq!(wires.len(), 2);
        assert!(wires[0].starts_with(
            format!("GET /v1/local-readings/{} ", req.binding.operation_id).as_bytes()
        ));
        assert!(wires[1].starts_with(b"POST /v1/local-readings "));
        assert!(wires[1].ends_with(&photo));
        let posted = String::from_utf8_lossy(&wires[1]);
        let binding = posted
            .lines()
            .find_map(|s| s.strip_prefix("x-recall-reading: "))
            .unwrap();
        assert_eq!(
            serde_json::from_str::<crate::reading::ReadingBinding>(binding).unwrap(),
            req.binding
        );
        let persisted = fs::read_to_string(root.0.join(format!(
            "Recall/_meta/readings/{}/connection-sha256",
            req.binding.operation_id
        )))
        .unwrap();
        assert_eq!(persisted, connection.fingerprint());
        assert!(!persisted.contains("synthetic-credential"));
        assert!(!persisted.contains(&origin));
    }
    #[test]
    fn reading_not_found_never_resends_after_connection_source_or_cancel_change() {
        for change in ["credential", "origin", "source", "cancel", "revision"] {
            let root = Fixture::new();
            let state = LocalVaultState::new(root.0.join("selected.json"));
            let token = state.select_path(&root.0).unwrap().vault_id.unwrap();
            let photo = b"\x89PNG\r\n\x1a\nSYNTHETIC";
            let m = state
                .with(&token, |v| {
                    v.capture(
                        &uuid::Uuid::new_v4().to_string(),
                        "synthetic.png",
                        photo,
                        "base",
                    )
                })
                .unwrap();
            let (v, req) = state
                .begin_reading(&token, &m.id, 1, &uuid::Uuid::new_v4().to_string())
                .unwrap();
            let (origin, server) = server(&req, "not_found");
            let connection = ProtectedConnection::test_connection(
                &origin,
                &req.binding.vault_id,
                "synthetic-credential",
            );
            let calls = Arc::new(Mutex::new(0));
            let count = calls.clone();
            let result = tauri::async_runtime::block_on(fetch_reading(
                &state,
                &token,
                &req,
                true,
                |_| {
                    let mut n = count.lock().unwrap();
                    *n += 1;
                    if *n == 2 {
                        match change {
                            "credential" => {
                                return Ok(ProtectedConnection::test_connection(
                                    &origin,
                                    &req.binding.vault_id,
                                    "changed-credential",
                                ))
                            }
                            "origin" => {
                                return Ok(ProtectedConnection::test_connection(
                                    "http://127.0.0.1:1",
                                    &req.binding.vault_id,
                                    "synthetic-credential",
                                ))
                            }
                            "source" => fs::write(
                                root.0.join(format!("Recall/Sources/{}.png", m.id)),
                                b"changed",
                            )
                            .unwrap(),
                            "cancel" => {
                                v.cancel_reading(&req.binding.operation_id).unwrap();
                            }
                            "revision" => {
                                v.correct(
                                    &m.id,
                                    1,
                                    &uuid::Uuid::new_v4().to_string(),
                                    "human changed",
                                )
                                .unwrap();
                            }
                            _ => unreachable!(),
                        }
                    }
                    Ok(connection.clone())
                },
                ReadingTransport::test_from_connection,
            ));
            assert!(result.is_err(), "{change}");
            assert_eq!(*calls.lock().unwrap(), 2);
            assert_eq!(server.join().unwrap().len(), 1, "{change}");
        }
    }
    #[test]
    fn reading_admitted_server_states_never_repost() {
        for status in ["in_flight", "unknown", "failed", "expired"] {
            let root = Fixture::new();
            let state = LocalVaultState::new(root.0.join("selected.json"));
            let token = state.select_path(&root.0).unwrap().vault_id.unwrap();
            let m = state
                .with(&token, |v| {
                    v.capture(
                        &uuid::Uuid::new_v4().to_string(),
                        "synthetic.png",
                        b"\x89PNG\r\n\x1a\nSYNTHETIC",
                        "base",
                    )
                })
                .unwrap();
            let (_, req) = state
                .begin_reading(&token, &m.id, 1, &uuid::Uuid::new_v4().to_string())
                .unwrap();
            let (origin, server) = server(&req, status);
            let c =
                ProtectedConnection::test_connection(&origin, &req.binding.vault_id, "synthetic");
            let result = tauri::async_runtime::block_on(fetch_reading(
                &state,
                &token,
                &req,
                true,
                |_| Ok(c.clone()),
                ReadingTransport::test_from_connection,
            ))
            .unwrap();
            assert_eq!(result.state, status);
            assert_eq!(server.join().unwrap().len(), 1);
        }
    }
}
