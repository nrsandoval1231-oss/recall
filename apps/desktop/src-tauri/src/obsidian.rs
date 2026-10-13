//! Read-only, scoped Obsidian handoff. The webview supplies an ID, never a path or URL.
use crate::local_vault::Vault;

fn encode(value: &str) -> String {
    value.bytes().map(|byte| {
        if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
            (byte as char).to_string()
        } else {
            format!("%{byte:02X}")
        }
    }).collect()
}

pub(crate) fn note_uri(vault: &Vault, memory_id: &str) -> Result<String, String> {
    let memory = vault.list_with_deleted("", false)?.into_iter()
        .find(|memory| memory.id == memory_id)
        .ok_or("That memory is not in the selected vault.")?;
    if memory.state != "active" || memory.conflict.is_some() || memory.revision == 0 {
        return Err("Resolve this note before opening it in Obsidian.".into());
    }
    let name = memory.note_path.ok_or("This memory has no Markdown note.")?;
    if name.contains('/') || name.contains('\\') || !name.ends_with(".md") {
        return Err("The note location needs review.".into());
    }
    Ok(format!("obsidian://open?vault={}&file={}",
        encode(&vault.root().to_string_lossy()), encode(&format!("Recall/Memories/{name}"))))
}

pub(crate) fn open(uri: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    command.arg(uri).spawn().map(|_| ()).map_err(|error|
        format!("Could not request Obsidian. Install Obsidian and register this vault: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn uri_encoding_cannot_add_query_parameters_or_shell_syntax() {
        assert_eq!(encode("A &B?/$()"), "A%20%26B%3F%2F%24%28%29");
    }
    #[test]
    fn only_a_current_note_from_this_vault_can_be_opened() {
        let root = std::env::temp_dir().join(format!("recall-obsidian-{}", uuid::Uuid::new_v4()));
        let vault = Vault::open(&root).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        assert!(note_uri(&vault, &id).is_err());
        let memory = vault.capture_note(&id, "Synthetic Obsidian handoff test").unwrap();
        let uri = note_uri(&vault, &memory.id).unwrap();
        assert!(uri.starts_with("obsidian://open?vault="));
        assert!(uri.ends_with(&format!("&file=Recall%2FMemories%2F{id}.md")));
        std::fs::remove_dir_all(root).unwrap();
    }
}
