use chrono::Utc;
use cron::Schedule;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::PathBuf, sync::{Arc, Mutex}, thread, time::Duration, io::Write, str::FromStr};
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager, State};
#[derive(Serialize)] struct CliResult { ok: bool, message: String }
struct Db(Arc<Mutex<Connection>>);
#[derive(Serialize)] struct TaskRow { id:String, name:String, repo:String, cron:String, agents:String, status:String }
#[derive(Deserialize)] struct NewTask { id:String, name:String, repo:String, cron:String, agents:Vec<String> }

fn migrate(conn: &Connection) -> rusqlite::Result<()> { conn.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, repo TEXT NOT NULL, cron TEXT NOT NULL, agents TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS repos (name TEXT PRIMARY KEY, path TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'local');") }

#[tauri::command]
fn run_agent_cli(provider: String, prompt: String, repo_path: String, db: State<Db>, app: AppHandle) -> CliResult { let message = format!("Queued {provider} task for {repo_path}: {prompt}"); if let Ok(conn)=db.0.lock(){let _=conn.execute("INSERT INTO events(kind,message,created_at) VALUES (?1,?2,?3)",params!["agent.queued",message,Utc::now().to_rfc3339()]);} let _=app.emit("wand://agent", message.clone()); CliResult { ok: true, message } }

#[tauri::command]
fn create_task(task: NewTask, db: State<Db>) -> Result<(),String> { let conn=db.0.lock().map_err(|e|e.to_string())?; conn.execute("INSERT OR REPLACE INTO tasks(id,name,repo,cron,agents,status,created_at) VALUES (?1,?2,?3,?4,?5,'queued',?6)",params![task.id,task.name,task.repo,task.cron,serde_json::to_string(&task.agents).map_err(|e|e.to_string())?,Utc::now().to_rfc3339()]).map_err(|e|e.to_string())?; Ok(()) }

#[tauri::command]
fn list_tasks(db: State<Db>) -> Result<Vec<TaskRow>,String> { let conn=db.0.lock().map_err(|e|e.to_string())?; let mut stmt=conn.prepare("SELECT id,name,repo,cron,agents,status FROM tasks ORDER BY created_at DESC").map_err(|e|e.to_string())?; let rows=stmt.query_map([],|r|Ok(TaskRow{id:r.get(0)?,name:r.get(1)?,repo:r.get(2)?,cron:r.get(3)?,agents:r.get(4)?,status:r.get(5)?})).map_err(|e|e.to_string())?; rows.map(|r|r.map_err(|e|e.to_string())).collect() }

#[derive(Serialize)] struct CliStatus { id:String, name:String, command:String, installed:bool, version:String }
#[tauri::command]
fn detect_clis() -> Vec<CliStatus> { let specs=[("claude","Claude","claude"),("codex","Codex","codex"),("kimi","Kimi","kimi"),("gemini","Gemini CLI","gemini")]; specs.iter().map(|(id,name,cmd)|{let path=Command::new("sh").args(["-lc",&format!("command -v {cmd}")]).output().ok().filter(|o|o.status.success()).map(|o|String::from_utf8_lossy(&o.stdout).trim().to_string()); let version=Command::new(cmd).arg("--version").output().ok().map(|o|String::from_utf8_lossy(&o.stdout).lines().next().unwrap_or("").to_string()).unwrap_or_default(); CliStatus{id:id.to_string(),name:name.to_string(),command:cmd.to_string(),installed:path.is_some(),version}}).collect() }
fn provider_service(provider:&str)->Result<&'static str,String>{match provider{"github"=>Ok("wand-github-pat"),"azure-devops"=>Ok("wand-azure-devops-pat"),_=>Err("Unsupported provider".into())}}
#[tauri::command]
fn save_provider_token(provider:String, token:String)->Result<(),String>{if token.trim().is_empty(){return Err("Token cannot be empty".into())} let service=provider_service(&provider)?; let entry=keyring::Entry::new(service,"default").map_err(|e|e.to_string())?; entry.set_password(&token).map_err(|e|e.to_string())}
#[tauri::command]
fn provider_status(provider:String)->Result<bool,String>{let service=provider_service(&provider)?; let entry=keyring::Entry::new(service,"default").map_err(|e|e.to_string())?; Ok(entry.get_password().is_ok())}
#[derive(Deserialize)] struct ChainRequest { task_id:String, prompt:String, repo_path:String, agents:Vec<String>, cli:String }
fn allowed_cli(cli:&str)->Option<&'static str>{match cli{"claude"=>Some("claude"),"codex"=>Some("codex"),"kimi"=>Some("kimi"),"gemini"=>Some("gemini"),_=>None}}
#[tauri::command]
fn run_agent_chain(req:ChainRequest, db:State<Db>, app:AppHandle)->Result<(),String>{let command=allowed_cli(&req.cli).ok_or_else(||"Unsupported CLI".to_string())?.to_string(); let db_arc=db.0.clone(); thread::spawn(move||{for (index,agent) in req.agents.iter().enumerate(){let _=app.emit("wand://agent",serde_json::json!({"task_id":req.task_id,"agent":agent,"stage":index+1,"status":"running"})); let mut child=match Command::new(&command).current_dir(&req.repo_path).arg("--print").arg(&req.prompt).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).spawn(){Ok(c)=>c,Err(e)=>{let _=app.emit("wand://agent",serde_json::json!({"task_id":req.task_id,"agent":agent,"status":"failed","error":e.to_string()}));return}}; if let Some(mut stdin)=child.stdin.take(){let _=stdin.write_all(format!("You are the {agent} stage. Complete your part, then summarize the handoff for the next agent.\n").as_bytes());} let output=child.wait_with_output(); match output{Ok(out) if out.status.success()=>{if let Ok(conn)=db_arc.lock(){let _=conn.execute("INSERT INTO events(kind,message,created_at) VALUES (?1,?2,?3)",params!["agent.completed",format!("{agent} completed stage {}",index+1),Utc::now().to_rfc3339()]);} let _=app.emit("wand://agent",serde_json::json!({"task_id":req.task_id,"agent":agent,"stage":index+1,"status":"completed","handoff":String::from_utf8_lossy(&out.stdout)}));},Ok(out)=>{let _=app.emit("wand://agent",serde_json::json!({"task_id":req.task_id,"agent":agent,"status":"failed","error":String::from_utf8_lossy(&out.stderr)}));return},Err(e)=>{let _=app.emit("wand://agent",serde_json::json!({"task_id":req.task_id,"agent":agent,"status":"failed","error":e.to_string()}));return}}} let _=app.emit("wand://agent",serde_json::json!({"task_id":req.task_id,"status":"verified"}));}); Ok(())}
#[derive(Clone, Serialize)]
struct SyncEvent { source: String, message: String, timestamp: String }

#[derive(Serialize)] struct ProviderRepo { name:String, path:String, provider:String, url:String }
async fn provider_token(provider:&str)->Result<String,String>{let service=provider_service(provider)?; let entry=keyring::Entry::new(service,"default").map_err(|e|e.to_string())?; entry.get_password().map_err(|e|e.to_string())}
#[tauri::command]
async fn sync_github(db:State<'_,Db>, app:AppHandle)->Result<Vec<ProviderRepo>,String>{let token=provider_token("github").await?; let response=reqwest::Client::new().get("https://api.github.com/user/repos?per_page=100&sort=updated").header("User-Agent","Wand").bearer_auth(token).send().await.map_err(|e|e.to_string())?; if !response.status().is_success(){return Err(format!("GitHub returned {}",response.status()))} let repos:Vec<serde_json::Value>=response.json().await.map_err(|e|e.to_string())?; let mut out=Vec::new(); let conn=db.0.lock().map_err(|e|e.to_string())?; for repo in repos{let name=repo["full_name"].as_str().unwrap_or_default().to_string(); let url=repo["html_url"].as_str().unwrap_or_default().to_string(); let path=repo["clone_url"].as_str().unwrap_or_default().to_string(); if name.is_empty(){continue} conn.execute("INSERT OR REPLACE INTO repos(name,path,provider) VALUES (?1,?2,'github')",params![name,path]).map_err(|e|e.to_string())?; out.push(ProviderRepo{name,path,provider:"github".into(),url});} let _=app.emit("wand://provider",serde_json::json!({"provider":"github","count":out.len()})); Ok(out)}
#[tauri::command]
async fn sync_azure_devops(provider_url:String, db:State<'_,Db>, app:AppHandle)->Result<Vec<ProviderRepo>,String>{let token=provider_token("azure-devops").await?; let endpoint=provider_url.trim_end_matches('/').to_string()+"/_apis/git/repositories?api-version=7.1"; let response=reqwest::Client::new().get(endpoint).basic_auth("",Some(token)).send().await.map_err(|e|e.to_string())?; if !response.status().is_success(){return Err(format!("Azure DevOps returned {}",response.status()))} let payload:serde_json::Value=response.json().await.map_err(|e|e.to_string())?; let mut out=Vec::new(); let conn=db.0.lock().map_err(|e|e.to_string())?; for repo in payload["value"].as_array().cloned().unwrap_or_default(){let name=repo["name"].as_str().unwrap_or_default().to_string(); let url=repo["webUrl"].as_str().unwrap_or_default().to_string(); let path=repo["remoteUrl"].as_str().unwrap_or_default().to_string(); if name.is_empty(){continue} conn.execute("INSERT OR REPLACE INTO repos(name,path,provider) VALUES (?1,?2,'azure-devops')",params![name,path]).map_err(|e|e.to_string())?; out.push(ProviderRepo{name,path,provider:"azure-devops".into(),url});} let _=app.emit("wand://provider",serde_json::json!({"provider":"azure-devops","count":out.len()})); Ok(out)}

fn start_background_sync(app: AppHandle, db: Arc<Mutex<Connection>>) {
  thread::spawn(move || {
    let mut last_due: HashMap<String, String> = HashMap::new();
    loop {
      let now = Utc::now();
      if let Ok(conn) = db.lock() {
        if let Ok(mut stmt) = conn.prepare("SELECT id,name,cron FROM tasks WHERE cron != 'one-off' AND status != 'completed'") {
          if let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_,String>(0)?, r.get::<_,String>(1)?, r.get::<_,String>(2)?))) {
            for row in rows.flatten() {
              let (id, name, expr) = row;
              if let Ok(schedule) = Schedule::from_str(&expr) {
                // Look back one polling window so a job is still detected when the
                // 30-second worker wakes just after the cron boundary.
                if let Some(next) = schedule.after(&(now - chrono::Duration::seconds(30))).next() {
                  let slot = next.to_rfc3339();
                  if next <= now && last_due.get(&id) != Some(&slot) {
                    last_due.insert(id.clone(), slot);
                    let message = format!("Scheduled task due: {name}");
                    let _ = conn.execute("INSERT INTO events(kind,message,created_at) VALUES (?1,?2,?3)", params!["scheduler.due", message, now.to_rfc3339()]);
                    let _ = app.emit("wand://scheduler", serde_json::json!({"task_id":id,"name":name,"status":"due","at":now.to_rfc3339()}));
                  }
                }
              }
            }
          }
        }
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM tasks WHERE cron != 'one-off' AND status != 'completed'", [], |r| r.get(0)).unwrap_or(0);
        let event = SyncEvent { source: "scheduler".into(), message: format!("Background scheduler active — {count} recurring task(s) monitored"), timestamp: now.to_rfc3339() };
        let _ = app.emit("wand://sync", event);
      }
      thread::sleep(Duration::from_secs(30));
    }
  });
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() { tauri::Builder::default().plugin(tauri_plugin_process::init()).plugin(tauri_plugin_updater::Builder::new().pubkey("dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDQyOTc2NzY4ODBFMDUzQ0QKUldUTlUrQ0FhR2VYUXJ3SFI0SytQbkIzaTBOaXdzWjNNYlNkb2dxLzdQdVJkcG9yZEhqeUQ0WUcK").build()).setup(|app| { let dir:PathBuf=app.path().app_data_dir().expect("app data dir"); fs::create_dir_all(&dir).expect("create app data dir"); let conn=Connection::open(dir.join("wand.db")).expect("open database"); migrate(&conn).expect("migrate database"); let db=Arc::new(Mutex::new(conn)); app.manage(Db(db.clone())); start_background_sync(app.handle().clone(),db); Ok(()) }).invoke_handler(tauri::generate_handler![run_agent_cli,run_agent_chain,create_task,list_tasks,detect_clis,save_provider_token,provider_status,sync_github,sync_azure_devops]).run(tauri::generate_context!()).expect("error while running wand"); }
