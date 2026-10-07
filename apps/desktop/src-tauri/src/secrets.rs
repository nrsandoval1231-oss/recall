//! Narrow credential-store boundary. The WebView can call exactly three commands, on one fixed
//! service name, with strictly validated keys and bounded values. There is no generic file, shell,
//! or HTTP capability anywhere in this app.

use keyring::Entry;

const SERVICE: &str = "app.recall.desktop.session";
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

fn entry(key: &str) -> Result<Entry, String> {
    validate_key(key)?;
    Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    if value.len() > MAX_VALUE_LEN {
        return Err("secret value too large".into());
    }
    entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_remove(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
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
