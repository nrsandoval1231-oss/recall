//! Narrow credential-store boundary. The WebView can call exactly three commands, on one fixed
//! service name, with strictly validated keys and bounded values. There is no generic file, shell,
//! or HTTP capability anywhere in this app.

use crate::keychain::{self, SecretStore, SESSION_SERVICE, SESSION_SERVICE_LEGACY};

const MAX_KEY_LEN: usize = 128;
// Windows Credential Manager limits a blob to ~2.5 KB; the JS side chunks well below that.
const MAX_VALUE_LEN: usize = 2000;

pub fn validate_key(key: &str) -> Result<(), String> {
    let ok = !key.is_empty()
        && key.len() <= MAX_KEY_LEN
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-');
    if ok {
        Ok(())
    } else {
        Err("invalid secret key".into())
    }
}

// Reads fall back to the pre-rename service and migrate forward; writes use the new service only;
// removal clears both (see `keychain`).
fn store(key: &str) -> Result<impl SecretStore, String> {
    validate_key(key)?;
    Ok(keychain::os_store(
        SESSION_SERVICE,
        SESSION_SERVICE_LEGACY,
        None,
    ))
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    store(&key)?.load(&key)
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    if value.len() > MAX_VALUE_LEN {
        return Err("secret value too large".into());
    }
    store(&key)?.save(&key, &value)
}

#[tauri::command]
pub fn secret_remove(key: String) -> Result<(), String> {
    store(&key)?.remove(&key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_keys() {
        for key in ["sb-session.0", "a_b-c.9", "X"] {
            assert!(validate_key(key).is_ok(), "{key}");
        }
    }

    #[test]
    fn rejects_empty_oversized_and_path_like_keys() {
        for key in [
            "",
            "../x",
            "a/b",
            "a b",
            "a:b",
            "a\\b",
            "ü",
            &"k".repeat(129),
        ] {
            assert!(validate_key(key).is_err(), "{key}");
        }
    }

    #[test]
    fn rejects_oversized_values_before_touching_the_store() {
        assert!(secret_set("k".into(), "v".repeat(MAX_VALUE_LEN + 1)).is_err());
    }
}
