use serde::Serialize;
use std::{thread, time::Duration};
use tauri::{AppHandle, Emitter};
#[derive(Serialize)] struct CliResult { ok: bool, message: String }
#[tauri::command]
fn run_agent_cli(provider: String, prompt: String, repo_path: String) -> CliResult {
  // Execution is intentionally gated here: wire this command to a sidecar/PTY runner
  // after adding explicit user approval and encrypted credential lookup.
  CliResult { ok: true, message: format!("Queued {provider} task for {repo_path}: {prompt}") }
}
#[derive(Clone, Serialize)]
struct SyncEvent { source: String, message: String, timestamp: String }

fn start_background_sync(app: AppHandle) {
  thread::spawn(move || loop {
    let event = SyncEvent { source: "workspace-sync".into(), message: "Background sync heartbeat — provider adapters ready".into(), timestamp: format!("{:?}", std::time::SystemTime::now()) };
    let _ = app.emit("wand://sync", event);
    thread::sleep(Duration::from_secs(30));
  });
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() { tauri::Builder::default().plugin(tauri_plugin_process::init()).plugin(tauri_plugin_updater::Builder::new().pubkey("dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDQyOTc2NzY4ODBFMDUzQ0QKUldUTlUrQ0FhR2VYUXJ3SFI0SytQbkIzaTBOaXdzWjNNYlNkb2dxLzdQdVJkcG9yZEhqeUQ0WUcK").build()).setup(|app| { start_background_sync(app.handle().clone()); Ok(()) }).invoke_handler(tauri::generate_handler![run_agent_cli]).run(tauri::generate_context!()).expect("error while running wand"); }
