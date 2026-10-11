// Console process. The window stays open so the Tailscale URL is visible.
fn main() {
    if let Err(err) = recall_desktop_lib::phone::run_from_env() {
        eprintln!("Recall phone companion: {err}");
        std::process::exit(1);
    }
}
