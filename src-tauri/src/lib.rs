use serde::Serialize;
#[derive(Serialize)] struct CliResult { ok: bool, message: String }
#[tauri::command]
fn run_agent_cli(provider: String, prompt: String, repo_path: String) -> CliResult {
  // Execution is intentionally gated here: wire this command to a sidecar/PTY runner
  // after adding explicit user approval and encrypted credential lookup.
  CliResult { ok: true, message: format!("Queued {provider} task for {repo_path}: {prompt}") }
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() { tauri::Builder::default().invoke_handler(tauri::generate_handler![run_agent_cli]).run(tauri::generate_context!()).expect("error while running forgepad"); }
