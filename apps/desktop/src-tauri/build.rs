fn main() {
    // The pairing origin is baked in at compile time; rebuild when either spelling changes.
    println!("cargo:rerun-if-env-changed=MONOLITH_PAIRING_ORIGIN");
    println!("cargo:rerun-if-env-changed=RECALL_PAIRING_ORIGIN");
    tauri_build::build()
}
