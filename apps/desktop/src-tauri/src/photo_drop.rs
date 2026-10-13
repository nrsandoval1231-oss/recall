//! Only OS-delivered drops authorize import paths. The renderer cannot add paths.
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Mutex,
};
#[derive(Default)]
pub struct PhotoDrops(Mutex<HashSet<PathBuf>>);
impl PhotoDrops {
    pub fn authorize(&self, paths: &[PathBuf]) {
        if let Ok(mut allowed) = self.0.lock() {
            // Bound retained user authorizations; originals are never touched here.
            if allowed.len() + paths.len() > 16 {
                allowed.clear();
            }
            allowed.extend(paths.iter().take(16).cloned());
        }
    }
    pub fn capture<T>(
        &self,
        path: &Path,
        save: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let mut allowed = self
            .0
            .lock()
            .map_err(|_| "Photo selection unavailable".to_owned())?;
        if !allowed.contains(path) {
            return Err("Drop this photo again to authorize its import.".to_owned());
        }
        let result = save();
        // Failed writes can retry the same user-authorized path. Successful writes use receipts.
        if result.is_ok() {
            allowed.remove(path);
        }
        result
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn renderer_paths_are_not_authorized_and_success_consumes_os_drop() {
        let drops = PhotoDrops::default();
        let path = PathBuf::from("/user/photo.png");
        assert!(drops.capture(&path, || Ok(())).is_err());
        drops.authorize(std::slice::from_ref(&path));
        assert!(drops.capture(&path, || Ok(())).is_ok());
        assert!(drops.capture(&path, || Ok(())).is_err());
    }
    #[test]
    fn failed_capture_keeps_drop_authorization_for_retry() {
        let drops = PhotoDrops::default();
        let path = PathBuf::from("/user/photo.png");
        drops.authorize(std::slice::from_ref(&path));
        assert!(drops
            .capture::<()>(&path, || Err("disk full".into()))
            .is_err());
        assert!(drops.capture(&path, || Ok(())).is_ok());
    }
}
