use chrono::Utc;
use cron::Schedule;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::process::Command;
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    str::FromStr,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State};
struct Db(Arc<Mutex<Connection>>);
#[derive(Serialize)]
struct TaskRow {
    id: String,
    name: String,
    repo: String,
    cron: String,
    agents: String,
    status: String,
}
#[derive(Deserialize)]
struct NewTask {
    id: String,
    name: String,
    repo: String,
    cron: String,
    agents: Vec<String>,
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let _ = conn.execute(
        "ALTER TABLE thread_messages ADD COLUMN agent_ids TEXT NOT NULL DEFAULT '[]'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agents ADD COLUMN cli TEXT NOT NULL DEFAULT 'codex'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agents ADD COLUMN model TEXT NOT NULL DEFAULT 'default'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agents ADD COLUMN scope TEXT NOT NULL DEFAULT 'workspace'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE thread_messages ADD COLUMN agent_ids TEXT NOT NULL DEFAULT '[]'",
        [],
    );
    conn.execute_batch(r#"PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, repo TEXT NOT NULL, cron TEXT NOT NULL, agents TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS repos (name TEXT PRIMARY KEY, path TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'local'); CREATE TABLE IF NOT EXISTS thread_messages (id INTEGER PRIMARY KEY, repo TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, agent_ids TEXT NOT NULL DEFAULT '[]'); CREATE INDEX IF NOT EXISTS idx_thread_messages_repo ON thread_messages(repo, created_at); CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, provider TEXT NOT NULL, repo TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, url TEXT NOT NULL, author TEXT NOT NULL, unread INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC); CREATE TABLE IF NOT EXISTS provider_settings (provider TEXT PRIMARY KEY, url TEXT NOT NULL); CREATE TABLE IF NOT EXISTS workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS task_runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, scheduled_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, status TEXT NOT NULL, error TEXT, UNIQUE(task_id,scheduled_at)); CREATE TABLE IF NOT EXISTS agent_transcripts (id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL, repo TEXT NOT NULL, agent TEXT NOT NULL, stage INTEGER NOT NULL, status TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_agent_transcripts_task ON agent_transcripts(task_id, created_at); CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, skills TEXT NOT NULL, color TEXT NOT NULL, built_in INTEGER NOT NULL DEFAULT 0, cli TEXT NOT NULL DEFAULT 'codex', model TEXT NOT NULL DEFAULT 'default', scope TEXT NOT NULL DEFAULT 'workspace'); INSERT OR IGNORE INTO agents(id,name,role,skills,color,built_in,cli,model,scope) VALUES ('planner','Planner','Breaks work into executable slices','["planning","repo analysis"]','#a98cff',1,'codex','default','workspace'),('builder','Builder','Implements features and fixes','["typescript","rust","testing"]','#76c6f5',1,'codex','default','workspace'),('reviewer','Code reviewer','Reviews changes and suggests fixes','["code review","security"]','#f9c86a',1,'codex','default','workspace'),('sentinel','Sentinel','Runs verification in the background','["ci","dependency audit","regression"]','#6fdaa0',1,'codex','default','workspace'),('docs','Docs writer','Keeps technical docs current','["documentation","changelog"]','#f38ba8',1,'codex','default','workspace');"#)?;
    let _ = conn.execute(
        "ALTER TABLE agents ADD COLUMN cli TEXT NOT NULL DEFAULT 'codex'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agents ADD COLUMN model TEXT NOT NULL DEFAULT 'default'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agents ADD COLUMN scope TEXT NOT NULL DEFAULT 'workspace'",
        [],
    );
    Ok(())
}

fn recover_interrupted_runs(conn: &Connection) -> rusqlite::Result<usize> {
    let now = Utc::now().to_rfc3339();
    let reason = "Wand closed before this run completed";
    let recovered = conn.execute(
        "UPDATE task_runs SET status='failed', finished_at=?1, error=COALESCE(error,?2) WHERE status IN ('queued','running')",
        params![now, reason],
    )?;
    conn.execute(
        "UPDATE tasks SET status=CASE WHEN lower(trim(cron))='one-off' THEN 'failed' ELSE 'queued' END WHERE status='running'",
        [],
    )?;
    if recovered > 0 {
        conn.execute(
            "INSERT INTO events(kind,message,created_at) VALUES ('scheduler.recovered',?1,?2)",
            params![format!("Recovered {recovered} interrupted task run(s)"), now],
        )?;
    }
    Ok(recovered)
}

#[derive(Serialize)]
struct FileVersions {
    original: String,
    modified: String,
}
#[tauri::command]
fn git_file_versions(repo_path: String, relative_path: String) -> Result<FileVersions, String> {
    if relative_path.trim().is_empty()
        || std::path::Path::new(&relative_path).is_absolute()
        || relative_path.contains('\0')
    {
        return Err("A valid relative file path is required".into());
    }
    let root = std::path::Path::new(&repo_path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let target = root
        .join(&relative_path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !target.starts_with(&root) {
        return Err("File is outside the selected repository".into());
    }
    let modified = fs::read_to_string(&target).map_err(|e| e.to_string())?;
    let original = Command::new("git")
        .current_dir(&root)
        .args(["show", &format!("HEAD:{relative_path}"), "--"])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(FileVersions {
        original: String::from_utf8_lossy(&original.stdout).to_string(),
        modified,
    })
}
#[derive(Serialize)]
struct ScannedRepo {
    name: String,
    path: String,
    provider: String,
    url: String,
}
#[tauri::command]
fn scan_repositories(root_path: String, db: State<Db>) -> Result<Vec<ScannedRepo>, String> {
    let root = std::path::Path::new(&root_path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut found = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() || !path.join(".git").exists() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|x| x.to_str())
            .unwrap_or_default()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let path_string = path.to_string_lossy().to_string();
        conn.execute(
            "INSERT OR REPLACE INTO repos(name,path,provider) VALUES (?1,?2,'local')",
            params![name, path_string],
        )
        .map_err(|e| e.to_string())?;
        let agent_id = format!("repo:{}:engineer", name);
        let agent_name = format!("{} engineer", name);
        conn.execute("INSERT OR IGNORE INTO agents(id,name,role,skills,color,built_in,cli,model,scope) VALUES (?1,?2,'Repository-scoped software engineer','[\"repo analysis\",\"implementation\",\"testing\"]','#76c6f5',0,'codex','default',?3)",params![agent_id,agent_name,format!("repo:{}",name)]).map_err(|e|e.to_string())?;
        found.push(ScannedRepo {
            name,
            path: path_string,
            provider: "local".into(),
            url: String::new(),
        });
    }
    Ok(found)
}
#[tauri::command]
fn save_repository(name: String, path: String, db: State<Db>) -> Result<ScannedRepo, String> {
    let name = name.trim().to_string();
    let root = std::path::Path::new(path.trim())
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if name.is_empty() || !root.is_dir() {
        return Err("A repository name and existing folder are required".into());
    }
    if !root.join(".git").exists() {
        return Err("The selected folder is not a Git repository".into());
    }
    let path_string = root.to_string_lossy().to_string();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO repos(name,path,provider) VALUES (?1,?2,'local')",
        params![name, path_string],
    )
    .map_err(|e| e.to_string())?;
    let agent_id = format!("repo:{}:engineer", name);
    let agent_name = format!("{} engineer", name);
    conn.execute("INSERT OR IGNORE INTO agents(id,name,role,skills,color,built_in,cli,model,scope) VALUES (?1,?2,'Repository-scoped software engineer','[\"repo analysis\",\"implementation\",\"testing\"]','#76c6f5',0,'codex','default',?3)",params![agent_id,agent_name,format!("repo:{}",name)]).map_err(|e|e.to_string())?;
    Ok(ScannedRepo {
        name,
        path: path_string,
        provider: "local".into(),
        url: String::new(),
    })
}

#[tauri::command]
fn create_task(task: NewTask, db: State<Db>) -> Result<(), String> {
    if task.name.trim().is_empty() {
        return Err("Task name cannot be empty".into());
    }
    if task.repo.trim().is_empty() {
        return Err("A repository is required".into());
    }
    if task.cron.trim() != "one-off" {
        parse_cron(task.cron.trim())
            .map_err(|error| format!("Invalid cron expression: {error}"))?;
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let repo_exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM repos WHERE name=?1)",
            params![task.repo.trim()],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !repo_exists {
        return Err(format!("Unknown repository: {}", task.repo.trim()));
    }
    for agent_id in &task.agents {
        let scope: String = conn
            .query_row(
                "SELECT scope FROM agents WHERE id=?1",
                params![agent_id],
                |row| row.get(0),
            )
            .map_err(|_| format!("Unknown agent: {agent_id}"))?;
        if scope != "workspace" && scope != format!("repo:{}", task.repo.trim()) {
            return Err(format!(
                "Agent {agent_id} is not available in repository {}",
                task.repo.trim()
            ));
        }
    }
    conn.execute("INSERT OR REPLACE INTO tasks(id,name,repo,cron,agents,status,created_at) VALUES (?1,?2,?3,?4,?5,'queued',?6)",params![task.id,task.name.trim(),task.repo.trim(),task.cron.trim(),serde_json::to_string(&task.agents).map_err(|e|e.to_string())?,Utc::now().to_rfc3339()]).map_err(|e|e.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_tasks(db: State<Db>) -> Result<Vec<TaskRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id,name,repo,cron,agents,status FROM tasks ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(TaskRow {
                id: r.get(0)?,
                name: r.get(1)?,
                repo: r.get(2)?,
                cron: r.get(3)?,
                agents: r.get(4)?,
                status: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.map(|r| r.map_err(|e| e.to_string())).collect()
}

#[tauri::command]
fn cancel_task(task_id: String, db: State<Db>, app: AppHandle) -> Result<(), String> {
    let task_id = task_id.trim().to_string();
    if task_id.is_empty() {
        return Err("Task id cannot be empty".into());
    }
    let now = Utc::now().to_rfc3339();
    let reason = "Cancelled by user";
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let changed = conn
        .execute(
            "UPDATE tasks SET status='cancelled' WHERE id=?1 AND status NOT IN ('completed','cancelled')",
            params![task_id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Task is already completed, cancelled, or does not exist".into());
    }
    conn.execute(
        "UPDATE task_runs SET status='cancelled',finished_at=?2,error=?3 WHERE task_id=?1 AND status IN ('queued','running')",
        params![task_id, now, reason],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO events(kind,message,created_at) VALUES ('task.cancelled',?1,?2)",
        params![format!("Task {task_id} cancelled"), now],
    )
    .map_err(|e| e.to_string())?;
    let _ = app.emit(
        "wand://agent",
        serde_json::json!({"task_id":task_id,"status":"cancelled"}),
    );
    Ok(())
}
#[derive(Serialize)]
struct AgentRow {
    id: String,
    name: String,
    role: String,
    skills: String,
    color: String,
    cli: String,
    model: String,
    system_prompt: String,
    scope: String,
    built_in: bool,
}
#[derive(Deserialize)]
struct NewAgent {
    id: String,
    name: String,
    role: String,
    skills: Vec<String>,
    color: String,
    cli: String,
    model: String,
    #[serde(default = "default_agent_scope")]
    scope: String,
}
#[derive(Deserialize, Serialize)]
struct ImportedAgent {
    id: Option<String>,
    name: String,
    role: String,
    #[serde(default)]
    skills: Vec<String>,
    #[serde(default = "default_agent_color")]
    color: String,
    #[serde(default = "default_agent_cli")]
    cli: String,
    #[serde(default = "default_agent_model")]
    model: String,
    #[serde(default = "default_agent_scope")]
    scope: String,
}
fn default_agent_color() -> String {
    "#76c6f5".into()
}
fn default_agent_cli() -> String {
    "codex".into()
}
fn default_agent_model() -> String {
    "default".into()
}
#[derive(Deserialize, Serialize)]
struct ImportedWorkflow {
    #[serde(default = "default_workflow_version")]
    version: u32,
    #[serde(default = "default_workflow_name")]
    name: String,
    agents: Vec<ImportedAgent>,
    #[serde(default)]
    steps: Vec<String>,
}
fn default_workflow_version() -> u32 {
    1
}
fn default_workflow_name() -> String {
    "Imported Wand workflow".into()
}
fn default_agent_scope() -> String {
    "workspace".into()
}
fn ensure_agent_prompt(conn: &Connection) -> rusqlite::Result<()> {
    let _ = conn.execute(
        "ALTER TABLE agents ADD COLUMN system_prompt TEXT NOT NULL DEFAULT ''",
        [],
    );
    conn.execute("UPDATE agents SET system_prompt=CASE id WHEN 'planner' THEN 'Break the request into small, verifiable steps. Inspect the repository before proposing work.' WHEN 'builder' THEN 'Implement the requested change carefully. Keep the diff focused and report tests run.' WHEN 'reviewer' THEN 'Review the complete change for correctness, security, regressions, and maintainability.' WHEN 'sentinel' THEN 'Verify the completed work independently. Run relevant checks and report concrete evidence.' WHEN 'docs' THEN 'Keep documentation accurate, concise, and aligned with the implementation.' ELSE system_prompt END WHERE system_prompt=''",[]).map(|_|())
}
#[derive(Serialize)]
struct TaskRunRow {
    id: String,
    task_id: String,
    scheduled_at: String,
    started_at: Option<String>,
    finished_at: Option<String>,
    status: String,
    error: Option<String>,
}
#[derive(Serialize)]
struct AgentTranscriptRow {
    id: i64,
    run_id: String,
    task_id: String,
    repo: String,
    agent: String,
    stage: i64,
    status: String,
    content: String,
    created_at: String,
}
#[tauri::command]
fn list_agent_transcripts(
    task_id: String,
    db: State<Db>,
) -> Result<Vec<AgentTranscriptRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id,run_id,task_id,repo,agent,stage,status,content,created_at FROM agent_transcripts WHERE task_id=?1 ORDER BY id ASC").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![task_id], |r| {
            Ok(AgentTranscriptRow {
                id: r.get(0)?,
                run_id: r.get(1)?,
                task_id: r.get(2)?,
                repo: r.get(3)?,
                agent: r.get(4)?,
                stage: r.get(5)?,
                status: r.get(6)?,
                content: r.get(7)?,
                created_at: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.map(|r| r.map_err(|e| e.to_string())).collect()
}
#[tauri::command]
fn list_task_runs(limit: Option<i64>, db: State<Db>) -> Result<Vec<TaskRunRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let amount = limit.unwrap_or(20).clamp(1, 100);
    let mut stmt=conn.prepare("SELECT id,task_id,scheduled_at,started_at,finished_at,status,error FROM task_runs ORDER BY scheduled_at DESC LIMIT ?1").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map(params![amount], |r| {
            Ok(TaskRunRow {
                id: r.get(0)?,
                task_id: r.get(1)?,
                scheduled_at: r.get(2)?,
                started_at: r.get(3)?,
                finished_at: r.get(4)?,
                status: r.get(5)?,
                error: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.map(|r| r.map_err(|e| e.to_string())).collect()
}
#[tauri::command]
fn list_agents(db: State<Db>) -> Result<Vec<AgentRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    ensure_agent_prompt(&conn).map_err(|e| e.to_string())?;
    let mut stmt=conn.prepare("SELECT id,name,role,skills,color,cli,model,system_prompt,scope,built_in FROM agents ORDER BY built_in DESC,name ASC").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(AgentRow {
                id: r.get(0)?,
                name: r.get(1)?,
                role: r.get(2)?,
                skills: r.get(3)?,
                color: r.get(4)?,
                cli: r.get(5)?,
                model: r.get(6)?,
                system_prompt: r.get(7)?,
                scope: r.get(8)?,
                built_in: r.get::<_, i64>(9)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.map(|r| r.map_err(|e| e.to_string())).collect()
}
#[tauri::command]
fn save_agent(agent: NewAgent, db: State<Db>) -> Result<(), String> {
    if agent.id.trim().is_empty() || agent.name.trim().is_empty() {
        return Err("Agent id and name are required".into());
    }
    if agent.role.chars().count() > 1000 {
        return Err("Agent responsibility must be 1000 characters or fewer".into());
    }
    if allowed_cli(&agent.cli).is_none() {
        return Err("Unsupported CLI runtime".into());
    }
    if agent.model.trim().is_empty() {
        return Err("Agent model is required".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let enabled_clis = cli_access_from_db(&conn)?;
    if !enabled_clis.iter().any(|cli| cli == &agent.cli) {
        return Err(format!(
            "CLI runtime '{}' is not enabled in Wand settings",
            agent.cli
        ));
    }
    if agent.scope != "workspace" {
        let repo_name = agent
            .scope
            .strip_prefix("repo:")
            .filter(|name| !name.trim().is_empty())
            .ok_or_else(|| "Agent scope must be workspace or repo:<name>".to_string())?;
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM repos WHERE name=?1)",
                params![repo_name],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !exists {
            return Err(format!("Unknown repository scope: {repo_name}"));
        }
    }
    ensure_agent_prompt(&conn).map_err(|e| e.to_string())?;
    conn.execute("INSERT OR REPLACE INTO agents(id,name,role,skills,color,cli,model,system_prompt,scope,built_in) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,COALESCE((SELECT built_in FROM agents WHERE id=?1),0))",params![agent.id,agent.name,agent.role,serde_json::to_string(&agent.skills).map_err(|e|e.to_string())?,agent.color,agent.cli,agent.model,agent.role,agent.scope]).map_err(|e|e.to_string())?;
    Ok(())
}
#[derive(Serialize)]
struct WorkflowImportResult {
    name: String,
    agents_imported: usize,
    steps: Vec<String>,
}
#[derive(Serialize)]
struct WorkflowRow {
    name: String,
    agents: Vec<String>,
    steps: Vec<String>,
}
#[tauri::command]
fn list_agent_workflows(db: State<Db>) -> Result<Vec<WorkflowRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT value FROM workspace_settings WHERE key LIKE 'agent-workflow:%' ORDER BY key ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut workflows = Vec::new();
    for raw in rows {
        let workflow: ImportedWorkflow = serde_json::from_str(&raw.map_err(|e| e.to_string())?)
            .map_err(|e| format!("Stored workflow is invalid: {e}"))?;
        let agents = workflow
            .agents
            .iter()
            .map(|agent| {
                agent.id.clone().unwrap_or_else(|| {
                    agent
                        .name
                        .to_lowercase()
                        .replace(|ch: char| !ch.is_ascii_alphanumeric(), "-")
                })
            })
            .collect();
        workflows.push(WorkflowRow {
            name: workflow.name,
            agents,
            steps: workflow.steps,
        });
    }
    Ok(workflows)
}
#[tauri::command]
fn import_agent_workflow(path: String, db: State<Db>) -> Result<WorkflowImportResult, String> {
    let raw = fs::read_to_string(&path).map_err(|e| format!("Unable to read workflow: {e}"))?;
    let workflow: ImportedWorkflow =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid Wand workflow JSON: {e}"))?;
    if workflow.version != 1 {
        return Err(format!(
            "Unsupported workflow version: {}",
            workflow.version
        ));
    }
    if workflow.agents.is_empty() || workflow.agents.len() > 100 {
        return Err("A workflow must contain between 1 and 100 agents".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    ensure_agent_prompt(&conn).map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    for imported in &workflow.agents {
        let id = imported.id.clone().unwrap_or_else(|| {
            imported
                .name
                .to_lowercase()
                .replace(|ch: char| !ch.is_ascii_alphanumeric(), "-")
        });
        if id.trim().is_empty() || imported.name.trim().is_empty() {
            return Err("Every imported agent needs a name and id".into());
        }
        if imported.role.chars().count() > 1000 {
            return Err(format!(
                "Agent '{}' exceeds the 1000 character responsibility limit",
                imported.name
            ));
        }
        if allowed_cli(&imported.cli).is_none() {
            return Err(format!(
                "Agent '{}' uses an unsupported CLI runtime",
                imported.name
            ));
        }
        if imported.model.trim().is_empty() {
            return Err(format!("Agent '{}' needs a model", imported.name));
        }
        if imported.scope != "workspace" {
            let repo = imported.scope.strip_prefix("repo:").unwrap_or_default();
            let exists: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM repos WHERE name=?1)",
                    params![repo],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if !exists {
                return Err(format!("Unknown repository scope: {}", imported.scope));
            }
        }
        let built_in: bool = conn
            .query_row(
                "SELECT COALESCE((SELECT built_in FROM agents WHERE id=?1),0)",
                params![id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if built_in {
            return Err(format!("Workflow cannot replace built-in agent '{id}'"));
        }
        conn.execute(
            "INSERT OR REPLACE INTO agents(id,name,role,skills,color,built_in,cli,model,system_prompt,scope) VALUES (?1,?2,?3,?4,0,?5,?6,?7,?3,?8)",
            params![id, imported.name, imported.role, serde_json::to_string(&imported.skills).map_err(|e| e.to_string())?, 0, imported.cli, imported.model, imported.scope],
        ).map_err(|e| e.to_string())?;
        ids.push(id);
    }
    for step in &workflow.steps {
        if !ids.iter().any(|id| id == step) {
            return Err(format!(
                "Workflow step references an agent not in the import: {step}"
            ));
        }
    }
    let workflow_key = format!(
        "agent-workflow:{}",
        workflow
            .name
            .to_lowercase()
            .replace(|ch: char| !ch.is_ascii_alphanumeric(), "-")
    );
    conn.execute(
        "INSERT OR REPLACE INTO workspace_settings(key,value) VALUES (?1,?2)",
        params![
            workflow_key,
            serde_json::to_string(&workflow).map_err(|e| e.to_string())?
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(WorkflowImportResult {
        name: workflow.name,
        agents_imported: ids.len(),
        steps: workflow.steps,
    })
}

#[derive(Serialize)]
struct ThreadMessage {
    id: i64,
    repo: String,
    author: String,
    body: String,
    created_at: String,
    agent_ids: Vec<String>,
}
#[tauri::command]
fn list_thread_messages(repo: String, db: State<Db>) -> Result<Vec<ThreadMessage>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt=conn.prepare("SELECT id,repo,author,body,created_at,agent_ids FROM thread_messages WHERE repo=?1 ORDER BY id ASC").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map(params![repo], |r| {
            Ok(ThreadMessage {
                id: r.get(0)?,
                repo: r.get(1)?,
                author: r.get(2)?,
                body: r.get(3)?,
                created_at: r.get(4)?,
                agent_ids: serde_json::from_str::<Vec<String>>(&r.get::<_, String>(5)?)
                    .unwrap_or_default(),
            })
        })
        .map_err(|e| e.to_string())?;
    rows.map(|r| r.map_err(|e| e.to_string())).collect()
}
#[tauri::command]
fn create_thread_message(
    repo: String,
    author: String,
    body: String,
    agent_ids: Option<Vec<String>>,
    db: State<Db>,
    app: AppHandle,
) -> Result<ThreadMessage, String> {
    let body = body.trim().to_string();
    if body.is_empty() {
        return Err("Message cannot be empty".into());
    }
    let created_at = Utc::now().to_rfc3339();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let agent_ids = agent_ids.unwrap_or_default();
    for agent_id in &agent_ids {
        let scope: String = conn
            .query_row(
                "SELECT scope FROM agents WHERE id=?1",
                params![agent_id],
                |row| row.get(0),
            )
            .map_err(|_| format!("Unknown agent mention: {agent_id}"))?;
        if scope != "workspace" && scope != format!("repo:{repo}") {
            return Err(format!(
                "Agent {agent_id} is not available in repository {repo}"
            ));
        }
    }
    let agent_ids_json = serde_json::to_string(&agent_ids).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO thread_messages(repo,author,body,created_at,agent_ids) VALUES (?1,?2,?3,?4,?5)",
        params![repo, author, body, created_at, agent_ids_json],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    let message = ThreadMessage {
        id,
        repo,
        author,
        body,
        created_at,
        agent_ids,
    };
    let _ = app.emit("wand://thread", &message);
    Ok(message)
}

#[derive(Serialize)]
struct NotificationRow {
    id: String,
    provider: String,
    repo: String,
    title: String,
    body: String,
    url: String,
    author: String,
    unread: bool,
    created_at: String,
}
#[tauri::command]
fn list_notifications(db: State<Db>) -> Result<Vec<NotificationRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt=conn.prepare("SELECT id,provider,repo,title,body,url,author,unread,created_at FROM notifications ORDER BY created_at DESC LIMIT 100").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(NotificationRow {
                id: r.get(0)?,
                provider: r.get(1)?,
                repo: r.get(2)?,
                title: r.get(3)?,
                body: r.get(4)?,
                url: r.get(5)?,
                author: r.get(6)?,
                unread: r.get::<_, i64>(7)? != 0,
                created_at: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.map(|r| r.map_err(|e| e.to_string())).collect()
}
#[tauri::command]
fn mark_notifications_read(db: State<Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE notifications SET unread=0", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
struct CliStatus {
    id: String,
    name: String,
    command: String,
    installed: bool,
    version: String,
}
fn installed_cli_path(command: &str) -> Option<String> {
    let lookup = if cfg!(windows) {
        Command::new("where").arg(command).output().ok()
    } else {
        Command::new("which").arg(command).output().ok()
    }?;
    if !lookup.status.success() {
        return None;
    }
    String::from_utf8_lossy(&lookup.stdout)
        .lines()
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}
#[tauri::command]
fn detect_clis() -> Vec<CliStatus> {
    let specs = [
        ("claude", "Claude", "claude"),
        ("codex", "Codex", "codex"),
        ("kimi", "Kimi", "kimi"),
        ("gemini", "Gemini CLI", "gemini"),
    ];
    specs
        .iter()
        .map(|(id, name, cmd)| {
            let path = installed_cli_path(cmd);
            let version = path
                .as_ref()
                .and_then(|_| Command::new(cmd).arg("--version").output().ok())
                .map(|output| {
                    let text = if output.stdout.is_empty() {
                        String::from_utf8_lossy(&output.stderr)
                    } else {
                        String::from_utf8_lossy(&output.stdout)
                    };
                    text.lines().next().unwrap_or("").trim().to_string()
                })
                .unwrap_or_default();
            CliStatus {
                id: id.to_string(),
                name: name.to_string(),
                command: cmd.to_string(),
                installed: path.is_some(),
                version,
            }
        })
        .collect()
}
fn cli_access_from_db(conn: &Connection) -> Result<Vec<String>, String> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM workspace_settings WHERE key='allowed-clis'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(value
        .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
        .unwrap_or_default())
}
fn first_enabled_installed_cli(conn: &Connection) -> Option<String> {
    cli_access_from_db(conn)
        .ok()?
        .into_iter()
        .find(|cli| installed_cli_path(cli).is_some())
}
#[tauri::command]
fn cli_access(db: State<Db>) -> Result<Vec<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    cli_access_from_db(&conn)
}
#[tauri::command]
fn save_cli_access(clis: Vec<String>, db: State<Db>) -> Result<(), String> {
    let mut normalized = clis
        .into_iter()
        .filter_map(|cli| allowed_cli(cli.trim()).map(str::to_string))
        .filter(|cli| installed_cli_path(cli).is_some())
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO workspace_settings(key,value) VALUES ('allowed-clis',?1)",
        params![serde_json::to_string(&normalized).map_err(|e| e.to_string())?],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn legacy_provider_service(provider: &str) -> Result<&'static str, String> {
    match provider {
        "github" => Ok("wand-github-pat"),
        "azure-devops" => Ok("wand-azure-devops-pat"),
        _ => Err("Unsupported provider".into()),
    }
}
fn installation_id() -> Result<String, String> {
    let entry = keyring::Entry::new("wand-installation", "id").map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(value) if !value.trim().is_empty() => Ok(value),
        _ => {
            let value = uuid::Uuid::new_v4().to_string();
            entry.set_password(&value).map_err(|e| e.to_string())?;
            Ok(value)
        }
    }
}
fn scoped_provider_service(base: &str, install: &str) -> String {
    format!("{base}-{install}")
}
fn provider_service(provider: &str) -> Result<String, String> {
    let base = legacy_provider_service(provider)?;
    let install = installation_id()?;
    Ok(scoped_provider_service(base, &install))
}
#[tauri::command]
fn save_provider_token(provider: String, token: String) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("Token cannot be empty".into());
    }
    let service = provider_service(&provider)?;
    let entry = keyring::Entry::new(&service, "default").map_err(|e| e.to_string())?;
    entry.set_password(&token).map_err(|e| e.to_string())
}
#[tauri::command]
fn provider_status(provider: String) -> Result<bool, String> {
    let service = provider_service(&provider)?;
    let entry = keyring::Entry::new(&service, "default").map_err(|e| e.to_string())?;
    if entry.get_password().is_ok() {
        return Ok(true);
    }
    let legacy = legacy_provider_service(&provider)?;
    Ok(keyring::Entry::new(legacy, "default")
        .ok()
        .and_then(|item| item.get_password().ok())
        .is_some())
}

#[tauri::command]
async fn test_provider_connection(
    provider: String,
    provider_url: Option<String>,
) -> Result<String, String> {
    let token = provider_token(&provider).await?;
    let client = reqwest::Client::new();
    let response = match provider.as_str() {
        "github" => client
            .get("https://api.github.com/user")
            .header("User-Agent", "Wand")
            .bearer_auth(token)
            .send()
            .await,
        "azure-devops" => {
            let base = validate_azure_org_url(
                provider_url
                    .as_deref()
                    .ok_or_else(|| "Azure DevOps organization URL is required".to_string())?,
            )?;
            client
                .get(format!(
                    "{base}/_apis/connectionData?connectOptions=1&lastChangeId=-1&lastChangeId64=-1"
                ))
                .basic_auth("", Some(token))
                .send()
                .await
        }
        _ => return Err("Unsupported provider".into()),
    }
    .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Provider returned {}", response.status()));
    }
    Ok("Connection verified".into())
}
#[tauri::command]
fn save_provider_url(provider: String, url: String, db: State<Db>) -> Result<(), String> {
    let value = url.trim().trim_end_matches('/').to_string();
    if value.is_empty() {
        return Err("Provider URL cannot be empty".into());
    }
    if provider != "azure-devops" {
        return Err("Only Azure DevOps organization URLs are configurable".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO provider_settings(provider,url) VALUES (?1,?2)",
        params![provider, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn provider_url(provider: String, db: State<Db>) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT url FROM provider_settings WHERE provider=?1",
        params![provider],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}
#[derive(Deserialize, Clone)]
struct AgentExecution {
    cli: String,
    model: String,
    #[serde(default)]
    responsibility: String,
    #[serde(default)]
    skills: Vec<String>,
}
#[derive(Deserialize, Clone)]
struct ChainRequest {
    task_id: String,
    prompt: String,
    repo_path: String,
    agents: Vec<String>,
    cli: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    agent_configs: HashMap<String, AgentExecution>,
    #[serde(default)]
    run_id: Option<String>,
}
fn allowed_cli(cli: &str) -> Option<&'static str> {
    match cli {
        "claude" => Some("claude"),
        "codex" => Some("codex"),
        "kimi" => Some("kimi"),
        "gemini" => Some("gemini"),
        _ => None,
    }
}
fn cli_args(cli: &str, model: &str, prompt: String) -> Result<Vec<String>, String> {
    let use_model = !model.trim().is_empty() && model != "default";
    let mut args = match cli {
        "claude" => vec!["-p".into()],
        "codex" => vec!["exec".into()],
        "kimi" => vec!["--print".into()],
        "gemini" => vec!["-p".into()],
        _ => return Err("Unsupported CLI".into()),
    };
    if use_model {
        match cli {
            "claude" | "gemini" => {
                args.push("--model".into());
                args.push(model.into())
            }
            "codex" => {
                args.push("--model".into());
                args.push(model.into())
            }
            "kimi" => {
                args.push("--model".into());
                args.push(model.into())
            }
            _ => {}
        }
    }
    args.push(prompt);
    Ok(args)
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn execute_stage(
    command: &str,
    model: &str,
    repo_path: &str,
    task_prompt: &str,
    agent: &str,
    handoff: &str,
    responsibility: &str,
    skills: &[String],
) -> Result<String, String> {
    let model_hint = if model.trim().is_empty() || model == "default" {
        "Use the CLI's configured default model.".to_string()
    } else {
        format!("Prefer the configured model: {model}.")
    };
    let responsibility = if responsibility.trim().is_empty() {
        "Use your configured engineering specialty and stay within the requested scope."
    } else {
        responsibility
    };
    let skills_text = if skills.is_empty() {
        "No additional skills specified.".to_string()
    } else {
        skills.join(", ")
    };
    let prompt = format!("{task_prompt}\n\nYou are the {agent} stage. {model_hint}\nRESPONSIBILITY: {responsibility}\nSKILLS: {skills_text}\nUse the repository state and the handoff below. Complete your part and return a concise handoff for the next stage.\n\nHANDOFF:\n{handoff}");
    let args = cli_args(command, model, prompt)?;
    let output = Command::new(command)
        .current_dir(repo_path)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
fn finish_run(
    db: &Arc<Mutex<Connection>>,
    run_id: &Option<String>,
    status: &str,
    error: Option<&str>,
) {
    if let Some(id) = run_id {
        if let Ok(conn) = db.lock() {
            let _ = conn.execute(
                "UPDATE task_runs SET status=?2,finished_at=?3,error=?4 WHERE id=?1",
                params![id, status, Utc::now().to_rfc3339(), error],
            );
        }
    }
}
#[tauri::command]
fn run_agent_chain_v2(mut req: ChainRequest, db: State<Db>, app: AppHandle) -> Result<(), String> {
    let command = allowed_cli(&req.cli)
        .ok_or_else(|| "Unsupported CLI".to_string())?
        .to_string();
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let allowed = cli_access_from_db(&conn)?;
        if !allowed.iter().any(|item| item == &command) {
            return Err(format!(
                "CLI runtime '{command}' is disabled in Wand settings"
            ));
        }
        let (repo_name, stored_path): (String, String) = conn
            .query_row(
                "SELECT tasks.repo,repos.path FROM tasks JOIN repos ON repos.name=tasks.repo WHERE tasks.id=?1",
                params![req.task_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| "Task or repository does not exist".to_string())?;
        if std::path::Path::new(&stored_path).canonicalize().ok()
            != std::path::Path::new(&req.repo_path).canonicalize().ok()
        {
            return Err("Agent execution path does not match the task repository".into());
        }
        for agent_id in &req.agents {
            let scope: String = conn
                .query_row(
                    "SELECT scope FROM agents WHERE id=?1",
                    params![agent_id],
                    |row| row.get(0),
                )
                .map_err(|_| format!("Unknown agent: {agent_id}"))?;
            if scope != "workspace" && scope != format!("repo:{repo_name}") {
                return Err(format!(
                    "Agent {agent_id} is not available in repository {repo_name}"
                ));
            }
        }
    }
    let run_id = req
        .run_id
        .take()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let scheduled_at = Utc::now().to_rfc3339();
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute("INSERT OR IGNORE INTO task_runs(id,task_id,scheduled_at,status) VALUES (?1,?2,?3,'queued')",params![run_id,&req.task_id,scheduled_at]).map_err(|e|e.to_string())?;
    }
    req.run_id = Some(run_id);
    launch_chain_worker(req, command, db.0.clone(), app);
    Ok(())
}
fn task_completion_status(cron: &str) -> &'static str {
    if cron.trim().eq_ignore_ascii_case("one-off") {
        "completed"
    } else {
        "queued"
    }
}
fn launch_chain_worker(
    req: ChainRequest,
    command: String,
    db_arc: Arc<Mutex<Connection>>,
    app: AppHandle,
) {
    thread::spawn(move || {
        if let Ok(conn) = db_arc.lock() {
            let _ = conn.execute(
                "UPDATE tasks SET status='running' WHERE id=?1",
                params![req.task_id],
            );
            if let Some(run_id) = &req.run_id {
                let _ = conn.execute(
                    "UPDATE task_runs SET status='running',started_at=?2 WHERE id=?1",
                    params![run_id, Utc::now().to_rfc3339()],
                );
            }
        }
        let mut handoff = String::from(
            "No previous stage output. Inspect the repository and begin from the task request.",
        );
        let mut stages = req.agents.clone();
        stages.push("sentinel-verifier".into());
        for (index, agent) in stages.iter().enumerate() {
            let cancelled = db_arc
                .lock()
                .ok()
                .and_then(|conn| {
                    conn.query_row(
                        "SELECT status='cancelled' FROM tasks WHERE id=?1",
                        params![req.task_id],
                        |row| row.get::<_, bool>(0),
                    )
                    .ok()
                })
                .unwrap_or(false);
            if cancelled {
                finish_run(&db_arc, &req.run_id, "cancelled", Some("Cancelled by user"));
                let _ = app.emit(
                    "wand://agent",
                    serde_json::json!({"task_id":req.task_id,"agent":agent,"status":"cancelled"}),
                );
                return;
            }
            let config = req.agent_configs.get(agent);
            let stage_command = config
                .and_then(|item| allowed_cli(&item.cli))
                .unwrap_or(&command)
                .to_string();
            if let Ok(conn) = db_arc.lock() {
                let allowed = cli_access_from_db(&conn).unwrap_or_default();
                if !allowed.iter().any(|item| item == &stage_command) {
                    let message =
                        format!("CLI runtime '{stage_command}' is disabled in Wand settings");
                    finish_run(&db_arc, &req.run_id, "failed", Some(&message));
                    let _ = app.emit("wand://agent", serde_json::json!({"task_id":req.task_id,"agent":agent,"status":"failed","error":message}));
                    return;
                }
            }
            let stage_model = config.map(|item| item.model.as_str()).unwrap_or(&req.model);
            let responsibility = config
                .map(|item| item.responsibility.as_str())
                .unwrap_or("");
            let skills = config.map(|item| item.skills.as_slice()).unwrap_or(&[]);
            let _=app.emit("wand://agent",serde_json::json!({"task_id":req.task_id,"agent":agent,"stage":index+1,"total":stages.len(),"cli":stage_command,"model":stage_model,"status":"running"}));
            match execute_stage(
                &stage_command,
                stage_model,
                &req.repo_path,
                &req.prompt,
                agent,
                &handoff,
                responsibility,
                skills,
            ) {
                Ok(output) => {
                    handoff = output.chars().take(12000).collect();
                    if let Ok(conn) = db_arc.lock() {
                        let repo: Option<String> = conn
                            .query_row(
                                "SELECT repo FROM tasks WHERE id=?1",
                                params![req.task_id],
                                |row| row.get(0),
                            )
                            .ok();
                        if let (Some(repo), Some(run_id)) = (repo.as_deref(), req.run_id.as_deref())
                        {
                            let _ = conn.execute(
                                "INSERT INTO agent_transcripts(run_id,task_id,repo,agent,stage,status,content,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                                params![run_id, req.task_id, repo, agent, index + 1, if agent == "sentinel-verifier" { "verified" } else { "completed" }, handoff, Utc::now().to_rfc3339()],
                            );
                        }
                        let _ = conn.execute(
                            "INSERT INTO events(kind,message,created_at) VALUES (?1,?2,?3)",
                            params![
                                if agent == "sentinel-verifier" {
                                    "agent.verified"
                                } else {
                                    "agent.completed"
                                },
                                format!("{agent} completed stage {}", index + 1),
                                Utc::now().to_rfc3339()
                            ],
                        );
                        if let Some(repo) = repo {
                            let created_at = Utc::now().to_rfc3339();
                            let body = format!("Stage {} handoff\n\n{}", index + 1, handoff);
                            let agent_ids =
                                serde_json::to_string(&vec![agent]).unwrap_or_else(|_| "[]".into());
                            if conn
                                .execute(
                                    "INSERT INTO thread_messages(repo,author,body,created_at,agent_ids) VALUES (?1,?2,?3,?4,?5)",
                                    params![repo, agent, body, created_at, agent_ids],
                                )
                                .is_ok()
                            {
                                let id = conn.last_insert_rowid();
                                let _ = app.emit(
                                    "wand://thread",
                                    serde_json::json!({
                                        "id": id,
                                        "repo": repo,
                                        "author": agent,
                                        "body": body,
                                        "created_at": created_at,
                                        "agent_ids": [agent]
                                    }),
                                );
                            }
                        }
                    }
                    let _=app.emit("wand://agent",serde_json::json!({"task_id":req.task_id,"agent":agent,"stage":index+1,"status":if agent=="sentinel-verifier"{"verified"}else{"completed"},"handoff":handoff}));
                }
                Err(error) => {
                    if let Ok(conn) = db_arc.lock() {
                        let repo: Option<String> = conn
                            .query_row(
                                "SELECT repo FROM tasks WHERE id=?1",
                                params![req.task_id],
                                |row| row.get(0),
                            )
                            .ok();
                        if let (Some(repo), Some(run_id)) = (repo, req.run_id.as_deref()) {
                            let _ = conn.execute(
                                "INSERT INTO agent_transcripts(run_id,task_id,repo,agent,stage,status,content,created_at) VALUES (?1,?2,?3,?4,?5,'failed',?6,?7)",
                                params![run_id, req.task_id, repo, agent, index + 1, error, Utc::now().to_rfc3339()],
                            );
                        }
                        let _ = conn.execute(
                            "UPDATE tasks SET status='failed' WHERE id=?1",
                            params![req.task_id],
                        );
                    }
                    finish_run(&db_arc, &req.run_id, "failed", Some(&error));
                    let _=app.emit("wand://agent",serde_json::json!({"task_id":req.task_id,"agent":agent,"stage":index+1,"status":"failed","error":error}));
                    return;
                }
            }
        }
        if let Ok(conn) = db_arc.lock() {
            let cron: Result<String, _> = conn.query_row(
                "SELECT cron FROM tasks WHERE id=?1",
                params![req.task_id],
                |r| r.get(0),
            );
            let status = cron
                .map(|value| task_completion_status(&value))
                .unwrap_or("completed");
            let _ = conn.execute(
                "UPDATE tasks SET status=?2 WHERE id=?1",
                params![req.task_id, status],
            );
        }
        finish_run(&db_arc, &req.run_id, "completed", None);
    });
}
fn parse_cron(expr: &str) -> Result<Schedule, String> {
    let fields = expr.split_whitespace().count();
    let normalized = if fields == 5 {
        format!("0 {expr}")
    } else {
        expr.to_string()
    };
    Schedule::from_str(&normalized).map_err(|e| e.to_string())
}

/// Return the latest occurrence between scheduler polls.
///
/// `Schedule::after` is exclusive. Starting the iterator exactly at the
/// previous poll timestamp would therefore skip a cron slot that falls on
/// that timestamp, which is common when the 30-second worker wakes just after
/// a minute boundary. A one-nanosecond overlap makes the poll interval
/// inclusive while still limiting catch-up to the current polling window.
fn latest_due_slot(
    schedule: &Schedule,
    previous_poll: chrono::DateTime<Utc>,
    now: chrono::DateTime<Utc>,
) -> Option<chrono::DateTime<Utc>> {
    let inclusive_start = previous_poll - chrono::Duration::nanoseconds(1);
    schedule
        .after(&inclusive_start)
        .take_while(|slot| *slot <= now)
        .last()
}

#[derive(Clone, Serialize, Deserialize)]
struct SyncEvent {
    source: String,
    message: String,
    timestamp: String,
}

#[derive(Serialize)]
struct ProviderRepo {
    name: String,
    path: String,
    provider: String,
    url: String,
}
async fn provider_token(provider: &str) -> Result<String, String> {
    let service = provider_service(provider)?;
    let entry = keyring::Entry::new(&service, "default").map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(value),
        Err(_) => {
            let legacy = legacy_provider_service(provider)?;
            let old = keyring::Entry::new(legacy, "default").map_err(|e| e.to_string())?;
            let value = old.get_password().map_err(|e| e.to_string())?;
            entry.set_password(&value).map_err(|e| e.to_string())?;
            Ok(value)
        }
    }
}
fn validate_azure_org_url(raw: &str) -> Result<String, String> {
    let value = raw.trim().trim_end_matches('/');
    let parsed = url::Url::parse(value).map_err(|_| "Azure DevOps URL is invalid".to_string())?;
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    let approved_host = host == "dev.azure.com"
        || host.ends_with(".dev.azure.com")
        || host.ends_with(".visualstudio.com");
    if parsed.scheme() != "https"
        || !approved_host
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("Azure DevOps URL must use HTTPS and an approved Azure DevOps host".into());
    }
    Ok(value.to_string())
}

fn parse_azure_pull_request_url(raw: &str) -> Result<(String, String, String, i64), String> {
    let parsed = url::Url::parse(raw.trim()).map_err(|_| "Azure pull-request URL is invalid".to_string())?;
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if parsed.scheme() != "https"
        || !(host == "dev.azure.com" || host.ends_with(".dev.azure.com") || host.ends_with(".visualstudio.com"))
    {
        return Err("Azure pull-request URL must use an approved HTTPS Azure DevOps host".into());
    }
    let segments: Vec<&str> = parsed
        .path_segments()
        .map(|segments| segments.collect())
        .unwrap_or_else(Vec::new);
    let git_index = segments.iter().position(|segment| *segment == "_git");
    let Some(git_index) = git_index else { return Err("Azure pull-request URL is missing its repository".into()) };
    if git_index == 0 || segments.len() <= git_index + 3 || segments[git_index + 2] != "pullrequest" {
        return Err("Azure pull-request URL must use the project/_git/repository/pullrequest/id form".into());
    }
    let pull_id = segments[git_index + 3].parse::<i64>().map_err(|_| "Azure pull-request ID is invalid".to_string())?;
    if pull_id <= 0 { return Err("Azure pull-request ID must be greater than zero".into()); }
    let base = format!("{}://{}", parsed.scheme(), parsed.host_str().unwrap_or_default());
    Ok((base, segments[git_index - 1].to_string(), segments[git_index + 1].to_string(), pull_id))
}

#[tauri::command]
async fn azure_pull_request_comment(url: String, body: String) -> Result<String, String> {
    let body = body.trim().to_string();
    if body.is_empty() { return Err("A comment cannot be empty".into()); }
    if body.chars().count() > 4000 { return Err("A comment cannot exceed 4000 characters".into()); }
    let (base, project, repository, pull_id) = parse_azure_pull_request_url(&url)?;
    let token = provider_token("azure-devops").await?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(20)).redirect(reqwest::redirect::Policy::none()).user_agent("Wand/0.1").build().map_err(|e| e.to_string())?;
    let endpoint = format!("{base}/{project}/_apis/git/repositories/{repository}/pullRequests/{pull_id}/threads?api-version=7.1-preview.1");
    let response = client.post(endpoint).basic_auth("", Some(token)).json(&serde_json::json!({"comments":[{"parentCommentId":0,"content":body,"commentType":1}],"status":1})).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() { return Err(format!("Azure DevOps returned {}", response.status())); }
    Ok("Azure DevOps pull-request comment posted".into())
}

#[tauri::command]
async fn azure_pull_request_approve(url: String) -> Result<String, String> {
    let (base, project, repository, pull_id) = parse_azure_pull_request_url(&url)?;
    let token = provider_token("azure-devops").await?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Wand/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let identity = client
        .get(format!("{base}/_apis/connectionData?connectOptions=none&lastChangeId=-1&lastChangeId64=-1"))
        .basic_auth("", Some(&token))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !identity.status().is_success() {
        return Err(format!("Azure DevOps returned {} while resolving the current user", identity.status()));
    }
    let identity: serde_json::Value = identity.json().await.map_err(|e| e.to_string())?;
    let reviewer = identity["authenticatedUser"]["id"].as_str().unwrap_or_default();
    if reviewer.is_empty() {
        return Err("Azure DevOps did not return the authenticated reviewer identity".into());
    }
    let endpoint = format!("{base}/{project}/_apis/git/repositories/{repository}/pullRequests/{pull_id}/reviewers/{reviewer}?api-version=7.1-preview.1");
    let response = client
        .put(endpoint)
        .basic_auth("", Some(token))
        .json(&serde_json::json!({"vote": 10}))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Azure DevOps returned {}", response.status()));
    }
    Ok("Azure DevOps pull request approved".into())
}

fn provider_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Wand/0.1")
        .build()
        .map_err(|error| format!("Unable to configure provider HTTP client: {error}"))
}

fn validate_github_repo(raw: &str) -> Result<String, String> {
    let value = raw.trim();
    let mut parts = value.split('/');
    let owner = parts.next().unwrap_or_default();
    let repo = parts.next().unwrap_or_default();
    if parts.next().is_some()
        || owner.is_empty()
        || repo.is_empty()
        || owner.contains(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_' && c != '.')
        || repo.contains(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_' && c != '.')
    {
        return Err("GitHub repository must use the owner/repository form".into());
    }
    Ok(value.to_string())
}

#[tauri::command]
async fn github_pull_request_action(
    repo: String,
    pull_number: u64,
    action: String,
    body: Option<String>,
) -> Result<String, String> {
    if pull_number == 0 {
        return Err("Pull request number must be greater than zero".into());
    }
    let repo = validate_github_repo(&repo)?;
    let action = action.trim().to_ascii_lowercase();
    let token = provider_token("github").await?;
    let client = provider_http_client()?;
    let endpoint = match action.as_str() {
        "comment" => format!("https://api.github.com/repos/{repo}/issues/{pull_number}/comments"),
        "approve" => format!("https://api.github.com/repos/{repo}/pulls/{pull_number}/reviews"),
        _ => return Err("Unsupported GitHub pull-request action".into()),
    };
    let payload = if action == "approve" {
        serde_json::json!({"event":"APPROVE","body":body.unwrap_or_default()})
    } else {
        let text = body.unwrap_or_default();
        if text.trim().is_empty() {
            return Err("A comment cannot be empty".into());
        }
        serde_json::json!({"body":text})
    };
    let response = client
        .post(endpoint)
        .bearer_auth(token)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("GitHub returned {}", response.status()));
    }
    Ok(format!("GitHub pull request action completed: {action}"))
}
#[tauri::command]
async fn sync_github(db: State<'_, Db>, app: AppHandle) -> Result<Vec<ProviderRepo>, String> {
    let token = provider_token("github").await?;
    let response = reqwest::Client::new()
        .get("https://api.github.com/user/repos?per_page=100&sort=updated")
        .header("User-Agent", "Wand")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("GitHub returned {}", response.status()));
    }
    let repos: Vec<serde_json::Value> = response.json().await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    for repo in repos {
        let name = repo["full_name"].as_str().unwrap_or_default().to_string();
        let url = repo["html_url"].as_str().unwrap_or_default().to_string();
        let path = repo["clone_url"].as_str().unwrap_or_default().to_string();
        if name.is_empty() {
            continue;
        }
        conn.execute(
            "INSERT OR REPLACE INTO repos(name,path,provider) VALUES (?1,?2,'github')",
            params![name, path],
        )
        .map_err(|e| e.to_string())?;
        out.push(ProviderRepo {
            name,
            path,
            provider: "github".into(),
            url,
        });
    }
    let _ = app.emit(
        "wand://provider",
        serde_json::json!({"provider":"github","count":out.len()}),
    );
    Ok(out)
}
#[tauri::command]
async fn sync_github_activity(db: State<'_, Db>, app: AppHandle) -> Result<u32, String> {
    let token = provider_token("github").await?;
    let names: Vec<String> = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT name FROM repos WHERE provider='github'")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<String>, _>>()
            .map_err(|e| e.to_string())?
    };
    let client = reqwest::Client::new();
    let mut added = 0;
    for name in names {
        let endpoint=format!("https://api.github.com/repos/{name}/issues/comments?per_page=50&sort=created&direction=desc");
        let response = client
            .get(endpoint)
            .header("User-Agent", "Wand")
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            continue;
        }
        let comments: Vec<serde_json::Value> = response.json().await.map_err(|e| e.to_string())?;
        for comment in comments {
            let id = format!("github:{}", comment["id"].as_i64().unwrap_or(0));
            let issue_url = comment["issue_url"].as_str().unwrap_or_default();
            let issue_response = client
                .get(issue_url)
                .header("User-Agent", "Wand")
                .bearer_auth(&token)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let issue: serde_json::Value = issue_response.json().await.unwrap_or_default();
            if issue["pull_request"].is_null() {
                continue;
            }
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            let changed=conn.execute("INSERT OR IGNORE INTO notifications(id,provider,repo,title,body,url,author,unread,created_at) VALUES (?1,'github',?2,?3,?4,?5,?6,1,?7)",params![id,name,issue["title"].as_str().unwrap_or("Pull request comment"),comment["body"].as_str().unwrap_or_default(),comment["html_url"].as_str().unwrap_or_default(),comment["user"]["login"].as_str().unwrap_or("GitHub"),comment["created_at"].as_str().unwrap_or_default()]).map_err(|e|e.to_string())?;
            if changed > 0 {
                added += 1;
            }
        }
    }
    let _ = app.emit(
        "wand://notifications",
        serde_json::json!({"provider":"github","added":added}),
    );
    Ok(added)
}
#[tauri::command]
async fn sync_azure_devops(
    provider_url: String,
    db: State<'_, Db>,
    app: AppHandle,
) -> Result<Vec<ProviderRepo>, String> {
    let token = provider_token("azure-devops").await?;
    let base = validate_azure_org_url(&provider_url)?;
    let endpoint = base + "/_apis/git/repositories?api-version=7.1";
    let response = reqwest::Client::new()
        .get(endpoint)
        .basic_auth("", Some(token))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Azure DevOps returned {}", response.status()));
    }
    let payload: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    for repo in payload["value"].as_array().cloned().unwrap_or_default() {
        let name = repo["name"].as_str().unwrap_or_default().to_string();
        let url = repo["webUrl"].as_str().unwrap_or_default().to_string();
        let path = repo["remoteUrl"].as_str().unwrap_or_default().to_string();
        if name.is_empty() {
            continue;
        }
        conn.execute(
            "INSERT OR REPLACE INTO repos(name,path,provider) VALUES (?1,?2,'azure-devops')",
            params![name, path],
        )
        .map_err(|e| e.to_string())?;
        out.push(ProviderRepo {
            name,
            path,
            provider: "azure-devops".into(),
            url,
        });
    }
    let _ = app.emit(
        "wand://provider",
        serde_json::json!({"provider":"azure-devops","count":out.len()}),
    );
    Ok(out)
}
#[tauri::command]
async fn sync_azure_activity(
    provider_url: String,
    db: State<'_, Db>,
    app: AppHandle,
) -> Result<u32, String> {
    let token = provider_token("azure-devops").await?;
    let base = validate_azure_org_url(&provider_url)?;
    let response = reqwest::Client::new()
        .get(format!(
            "{base}/_apis/git/pullrequests?searchCriteria.status=all&api-version=7.1"
        ))
        .basic_auth("", Some(&token))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Azure DevOps returned {}", response.status()));
    }
    let pulls: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let client = reqwest::Client::new();
    let mut added = 0;
    for pull in pulls["value"].as_array().cloned().unwrap_or_default() {
        let repo_id = pull["repository"]["id"].as_str().unwrap_or_default();
        let project = pull["repository"]["project"]["id"]
            .as_str()
            .unwrap_or_default();
        let pull_id = pull["pullRequestId"].as_i64().unwrap_or(0);
        if repo_id.is_empty() || project.is_empty() || pull_id == 0 {
            continue;
        }
        let threads=client.get(format!("{base}/{project}/_apis/git/repositories/{repo_id}/pullRequests/{pull_id}/threads?api-version=7.1")).basic_auth("",Some(&token)).send().await.map_err(|e|e.to_string())?;
        let payload: serde_json::Value = threads.json().await.unwrap_or_default();
        for thread in payload["value"].as_array().cloned().unwrap_or_default() {
            for comment in thread["comments"].as_array().cloned().unwrap_or_default() {
                let id = format!("azure:{}", comment["id"].as_i64().unwrap_or(0));
                let conn = db.0.lock().map_err(|e| e.to_string())?;
                let changed=conn.execute("INSERT OR IGNORE INTO notifications(id,provider,repo,title,body,url,author,unread,created_at) VALUES (?1,'azure-devops',?2,?3,?4,?5,?6,1,?7)",params![id,pull["repository"]["name"].as_str().unwrap_or("Azure repository"),pull["title"].as_str().unwrap_or("Pull request comment"),comment["content"].as_str().unwrap_or_default(),pull["url"].as_str().unwrap_or_default(),comment["author"]["displayName"].as_str().unwrap_or("Azure DevOps"),comment["publishedDate"].as_str().unwrap_or_default()]).map_err(|e|e.to_string())?;
                if changed > 0 {
                    added += 1;
                }
            }
        }
    }
    let _ = app.emit(
        "wand://notifications",
        serde_json::json!({"provider":"azure-devops","added":added}),
    );
    Ok(added)
}

fn emit_provider_health(app: &AppHandle, provider: &str, status: &str, error: Option<String>) {
    let mut payload = serde_json::json!({"provider":provider,"status":status});
    if let Some(error) = error {
        payload["error"] = serde_json::Value::String(error);
    }
    let _ = app.emit("wand://provider", payload);
}

async fn background_github_activity(db: Arc<Mutex<Connection>>, app: AppHandle) {
    let token = match provider_token("github").await {
        Ok(value) => value,
        Err(_) => return,
    };
    let names: Vec<String> = {
        let conn = match db.lock() {
            Ok(value) => value,
            Err(_) => return,
        };
        let mut stmt = match conn.prepare("SELECT name FROM repos WHERE provider='github'") {
            Ok(value) => value,
            Err(_) => return,
        };
        let rows = match stmt.query_map([], |r| r.get(0)) {
            Ok(value) => value,
            Err(_) => return,
        };
        match rows.collect::<Result<Vec<String>, _>>() {
            Ok(value) => value,
            Err(_) => return,
        }
    };
    let client = reqwest::Client::new();
    let mut added = 0;
    for name in names {
        let response=match client.get(format!("https://api.github.com/repos/{name}/pulls/comments?per_page=50&sort=created&direction=desc")).header("User-Agent","Wand").bearer_auth(&token).send().await{Ok(value)=>value,Err(error)=>{emit_provider_health(&app,"github","error",Some(format!("GitHub request failed for {name}: {error}"))); return;}};
        if !response.status().is_success() {
            emit_provider_health(&app,"github","error",Some(format!("GitHub returned {} for {name}",response.status())));
            continue;
        }
        let comments: Vec<serde_json::Value> = match response.json().await {
            Ok(value) => value,
            Err(error) => { emit_provider_health(&app,"github","error",Some(format!("GitHub response could not be read for {name}: {error}"))); return; },
        };
        for comment in comments {
            let id = format!("github-review:{}", comment["id"].as_i64().unwrap_or(0));
            let conn = match db.lock() {
                Ok(value) => value,
                Err(error) => { emit_provider_health(&app,"github","error",Some(format!("Database lock failed: {error}"))); return; },
            };
            let changed=conn.execute("INSERT OR IGNORE INTO notifications(id,provider,repo,title,body,url,author,unread,created_at) VALUES (?1,'github',?2,'Pull request review comment',?3,?4,?5,1,?6)",params![id,name,comment["body"].as_str().unwrap_or_default(),comment["html_url"].as_str().unwrap_or_default(),comment["user"]["login"].as_str().unwrap_or("GitHub"),comment["created_at"].as_str().unwrap_or_default()]);
            if changed.unwrap_or(0) > 0 {
                added += 1
            }
        }
    }
    if added > 0 {
        let _ = app.emit(
            "wand://notifications",
            serde_json::json!({"provider":"github","added":added,"background":true}),
        );
    }
    emit_provider_health(&app, "github", "ok", None);
}
async fn report_provider_credentials(app: AppHandle) {
    for provider in ["github", "azure-devops"] {
        if let Err(error) = provider_token(provider).await {
            let _=app.emit("wand://provider",serde_json::json!({"provider":provider,"status":"error","error":format!("Credential check failed: {error}")}));
        }
    }
}
async fn background_azure_activity(db: Arc<Mutex<Connection>>, app: AppHandle) {
    let token = match provider_token("azure-devops").await {
        Ok(value) => value,
        Err(error) => { emit_provider_health(&app,"azure-devops","error",Some(format!("Credential check failed: {error}"))); return; },
    };
    let base: Option<String> = {
        let conn = match db.lock() {
            Ok(value) => value,
            Err(error) => { emit_provider_health(&app,"azure-devops","error",Some(format!("Database lock failed: {error}"))); return; },
        };
        conn.query_row(
            "SELECT url FROM provider_settings WHERE provider='azure-devops'",
            [],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten()
    };
    let Some(base) = base else { emit_provider_health(&app,"azure-devops","error",Some("Azure DevOps organization URL is not configured".into())); return };
    let client = reqwest::Client::new();
    let response = match client
        .get(format!(
            "{base}/_apis/git/pullrequests?searchCriteria.status=all&api-version=7.1"
        ))
        .basic_auth("", Some(&token))
        .send()
        .await
    {
        Ok(value) => value,
        Err(error) => { emit_provider_health(&app,"azure-devops","error",Some(format!("Azure DevOps request failed: {error}"))); return; },
    };
    if !response.status().is_success() {
        emit_provider_health(&app,"azure-devops","error",Some(format!("Azure DevOps returned {}",response.status())));
        return;
    }
    let pulls: serde_json::Value = match response.json().await {
        Ok(value) => value,
            Err(error) => { emit_provider_health(&app,"azure-devops","error",Some(format!("Azure DevOps response could not be read: {error}"))); return; },
    };
    let mut added = 0;
    for pull in pulls["value"].as_array().cloned().unwrap_or_default() {
        let repo_id = pull["repository"]["id"].as_str().unwrap_or_default();
        let project = pull["repository"]["project"]["id"]
            .as_str()
            .unwrap_or_default();
        let pull_id = pull["pullRequestId"].as_i64().unwrap_or(0);
        if repo_id.is_empty() || project.is_empty() || pull_id == 0 {
            continue;
        }
        let response=match client.get(format!("{base}/{project}/_apis/git/repositories/{repo_id}/pullRequests/{pull_id}/threads?api-version=7.1")).basic_auth("",Some(&token)).send().await{Ok(value)=>value,Err(_)=>continue};
        let threads: serde_json::Value = match response.json().await {
            Ok(value) => value,
            Err(_) => continue,
        };
        for thread in threads["value"].as_array().cloned().unwrap_or_default() {
            for comment in thread["comments"].as_array().cloned().unwrap_or_default() {
                let id = format!("azure:{}", comment["id"].as_i64().unwrap_or(0));
                let conn = match db.lock() {
                    Ok(value) => value,
                    Err(_) => return,
                };
                let changed=conn.execute("INSERT OR IGNORE INTO notifications(id,provider,repo,title,body,url,author,unread,created_at) VALUES (?1,'azure-devops',?2,?3,?4,?5,?6,1,?7)",params![id,pull["repository"]["name"].as_str().unwrap_or("Azure repository"),pull["title"].as_str().unwrap_or("Pull request comment"),comment["content"].as_str().unwrap_or_default(),pull["url"].as_str().unwrap_or_default(),comment["author"]["displayName"].as_str().unwrap_or("Azure DevOps"),comment["publishedDate"].as_str().unwrap_or_default()]);
                if changed.unwrap_or(0) > 0 {
                    added += 1
                }
            }
        }
    }
    if added > 0 {
        let _ = app.emit(
            "wand://notifications",
            serde_json::json!({"provider":"azure-devops","added":added,"background":true}),
        );
    }
    emit_provider_health(&app, "azure-devops", "ok", None);
}

fn start_background_sync(app: AppHandle, db: Arc<Mutex<Connection>>) {
    thread::spawn(move || {
        let mut last_due: HashMap<String, String> = HashMap::new();
        let mut previous_poll = Utc::now() - chrono::Duration::seconds(30);
        let mut last_provider_poll: Option<Instant> = None;
        let startup = SyncEvent {
            source: "startup".into(),
            message: "Background workers active — scheduler and provider polling started".into(),
            timestamp: Utc::now().to_rfc3339(),
        };
        if let Ok(conn) = db.lock() {
            let _ = conn.execute(
                "INSERT OR REPLACE INTO workspace_settings(key,value) VALUES ('background-status',?1)",
                params![serde_json::to_string(&startup).unwrap_or_default()],
            );
        }
        let _ = app.emit("wand://sync", startup);
        loop {
            let now = Utc::now();
            let provider_poll_due = last_provider_poll
                .map(|started| started.elapsed() >= Duration::from_secs(300))
                .unwrap_or(true);
            if provider_poll_due {
                last_provider_poll = Some(Instant::now());
                let poll_db = db.clone();
                let poll_app = app.clone();
                tauri::async_runtime::spawn(async move {
                    report_provider_credentials(poll_app.clone()).await;
                    background_github_activity(poll_db.clone(), poll_app.clone()).await;
                    background_azure_activity(poll_db, poll_app).await;
                });
            }
            if let Ok(conn) = db.lock() {
                if let Ok(mut stmt) = conn.prepare("SELECT id,name,cron FROM tasks WHERE cron != 'one-off' AND status NOT IN ('completed','cancelled')") {
          if let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_,String>(0)?, r.get::<_,String>(1)?, r.get::<_,String>(2)?))) {
            for row in rows.flatten() {
              let (id, name, expr) = row;
              if let Ok(schedule) = parse_cron(&expr) {
                if let Some(next) = latest_due_slot(&schedule, previous_poll, now) {
                  let slot = next.to_rfc3339();
                  if next <= now && last_due.get(&id) != Some(&slot) {
                    last_due.insert(id.clone(), slot.clone());
                    let message = format!("Scheduled task due: {name}");
                    let _ = conn.execute("INSERT INTO events(kind,message,created_at) VALUES (?1,?2,?3)", params!["scheduler.due", message, now.to_rfc3339()]);
                    let _ = app.emit("wand://scheduler", serde_json::json!({"task_id":id,"name":name,"status":"due","at":now.to_rfc3339()}));
                    let cli = first_enabled_installed_cli(&conn);
                    if let Some(cli) = cli { if let Ok((agents_json, repo_name)) = conn.query_row("SELECT agents,repo FROM tasks WHERE id=?1",params![id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))) { if let Ok(agents) = serde_json::from_str::<Vec<String>>(&agents_json) { if let Ok(repo_path) = conn.query_row("SELECT path FROM repos WHERE name=?1",params![repo_name],|r|r.get::<_,String>(0)) { let agent_configs = agents.iter().filter_map(|agent_id| conn.query_row("SELECT cli,model,role,skills FROM agents WHERE id=?1",params![agent_id],|r| { let skills_json: String = r.get(3)?; Ok(AgentExecution { cli: r.get(0)?, model: r.get(1)?, responsibility: r.get(2)?, skills: serde_json::from_str(&skills_json).unwrap_or_default() }) }).ok().map(|config| (agent_id.clone(), config))).collect(); let run_id=format!("{}-{}",id,slot); let run_inserted=conn.execute("INSERT OR IGNORE INTO task_runs(id,task_id,scheduled_at,status) VALUES (?1,?2,?3,'queued')",params![run_id,id,slot]).unwrap_or(0); if run_inserted>0 { launch_chain_worker(ChainRequest{task_id:id.clone(),prompt:format!("Scheduled task: {name}"),repo_path,agents,cli:cli.to_string(),model:"default".into(),agent_configs,run_id:Some(run_id)},cli.to_string(),db.clone(),app.clone()); } } } } }
                  }
                }
              }
            }
          }
        }
                let count: i64 = conn.query_row("SELECT COUNT(*) FROM tasks WHERE cron != 'one-off' AND status != 'completed'", [], |r| r.get(0)).unwrap_or(0);
                let event = SyncEvent {
                    source: "scheduler".into(),
                    message: format!(
                        "Background scheduler active — {count} recurring task(s) monitored"
                    ),
                    timestamp: now.to_rfc3339(),
                };
                let _ = conn.execute(
                    "INSERT OR REPLACE INTO workspace_settings(key,value) VALUES ('background-status',?1)",
                    params![serde_json::to_string(&event).unwrap_or_default()],
                );
                let _ = app.emit("wand://sync", event);
            }
            previous_poll = now;
            thread::sleep(Duration::from_secs(30));
        }
    });
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default().plugin(tauri_plugin_process::init()).plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_notification::init()).plugin(tauri_plugin_updater::Builder::new().pubkey("dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDQyOTc2NzY4ODBFMDUzQ0QKUldUTlUrQ0FhR2VYUXJ3SFI0SytQbkIzaTBOaXdzWjNNYlNkb2dxLzdQdVJkcG9yZEhqeUQ0WUcK").build()).setup(|app| { let dir:PathBuf=app.path().app_data_dir().expect("app data dir"); fs::create_dir_all(&dir).expect("create app data dir"); let conn=Connection::open(dir.join("wand.db")).expect("open database"); migrate(&conn).expect("migrate database"); recover_interrupted_runs(&conn).expect("recover interrupted runs"); let db=Arc::new(Mutex::new(conn)); app.manage(Db(db.clone())); start_background_sync(app.handle().clone(),db); Ok(()) }).invoke_handler(tauri::generate_handler![read_repo_file,write_repo_file,git_diff,git_file_versions,scan_repositories,save_repository,save_workspace_root,workspace_root,background_status,workspace_setting,save_workspace_setting,save_user_name,user_name,list_repositories,run_agent_chain_v2,create_task,cancel_task,list_tasks,list_task_runs,list_agent_transcripts,list_events,list_agents,save_agent,import_agent_workflow,list_agent_workflows,list_thread_messages,create_thread_message,list_notifications,mark_notifications_read,detect_clis,cli_access,save_cli_access,save_provider_token,provider_status,test_provider_connection,save_provider_url,provider_url,github_pull_request_action,azure_pull_request_comment,azure_pull_request_approve,sync_github,sync_github_activity,sync_azure_devops,sync_azure_activity]).run(tauri::generate_context!()).expect("error while running wand");
}
#[tauri::command]
fn read_repo_file(repo_path: String, relative_path: String) -> Result<String, String> {
    let root = std::path::Path::new(&repo_path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let target = root
        .join(&relative_path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !target.starts_with(&root) {
        return Err("File is outside the selected repository".into());
    }
    fs::read_to_string(target).map_err(|e| e.to_string())
}
#[tauri::command]
fn write_repo_file(
    repo_path: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let root = std::path::Path::new(&repo_path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let candidate = root.join(&relative_path);
    if relative_path.trim().is_empty() || relative_path.contains('\0') {
        return Err("A valid relative file path is required".into());
    }
    let target = if candidate.exists() {
        candidate.canonicalize().map_err(|e| e.to_string())?
    } else {
        candidate
    };
    if !target.starts_with(&root) {
        return Err("File is outside the selected repository".into());
    }
    if target.exists() && !target.is_file() {
        return Err("Refusing to write a directory".into());
    }
    fs::write(target, content).map_err(|e| e.to_string())
}
#[tauri::command]
fn git_diff(repo_path: String) -> Result<String, String> {
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(["diff", "--no-ext-diff", "--unified=60"])
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
#[derive(Serialize)]
struct EventRow {
    id: i64,
    kind: String,
    message: String,
    created_at: String,
}
#[tauri::command]
fn list_events(limit: Option<i64>, db: State<Db>) -> Result<Vec<EventRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let amount = limit.unwrap_or(20).clamp(1, 100);
    let mut stmt = conn
        .prepare("SELECT id,kind,message,created_at FROM events ORDER BY id DESC LIMIT ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![amount], |r| {
            Ok(EventRow {
                id: r.get(0)?,
                kind: r.get(1)?,
                message: r.get(2)?,
                created_at: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.map(|r| r.map_err(|e| e.to_string())).collect()
}
#[tauri::command]
fn save_workspace_root(root: String, db: State<Db>) -> Result<(), String> {
    let value = root.trim().to_string();
    if value.is_empty() {
        return Err("Workspace root cannot be empty".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO provider_settings(provider,url) VALUES ('workspace-root',?1)",
        params![value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn workspace_root(db: State<Db>) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT url FROM provider_settings WHERE provider='workspace-root'",
        [],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}
#[tauri::command]
fn background_status(db: State<Db>) -> Result<Option<SyncEvent>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT value FROM workspace_settings WHERE key='background-status'",
        [],
        |row| {
            let value: String = row.get(0)?;
            Ok(serde_json::from_str::<SyncEvent>(&value).ok())
        },
    )
    .optional()
    .map_err(|e| e.to_string())
    .map(|value| value.flatten())
}
#[tauri::command]
fn workspace_setting(key: String, db: State<Db>) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT value FROM workspace_settings WHERE key=?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}
#[tauri::command]
fn save_workspace_setting(key: String, value: String, db: State<Db>) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("Setting key cannot be empty".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO workspace_settings(key,value) VALUES (?1,?2)",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn save_user_name(name: String, db: State<Db>) -> Result<(), String> {
    let value = name.trim().to_string();
    if value.is_empty() {
        return Err("Name cannot be empty".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO workspace_settings(key,value) VALUES ('user-name',?1)",
        params![value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn user_name(db: State<Db>) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT value FROM workspace_settings WHERE key='user-name'",
        [],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}
#[tauri::command]
fn list_repositories(db: State<Db>) -> Result<Vec<ScannedRepo>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT name,path,provider FROM repos ORDER BY name")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ScannedRepo {
                name: r.get(0)?,
                path: r.get(1)?,
                provider: r.get(2)?,
                url: String::new(),
            })
        })
        .map_err(|e| e.to_string())?;
    rows.map(|r| r.map_err(|e| e.to_string())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_user_friendly_five_field_cron() {
        assert!(parse_cron("0 9 * * 1").is_ok());
    }

    #[test]
    fn keeps_full_cron_expression_support() {
        assert!(parse_cron("0 0 9 * * 1 *").is_ok());
    }

    #[test]
    fn recurring_tasks_remain_active_after_a_successful_run() {
        assert_eq!(task_completion_status("one-off"), "completed");
        assert_eq!(task_completion_status("0 9 * * 1"), "queued");
    }

    #[test]
    fn scheduler_requires_an_enabled_cli_runtime() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();

        assert_eq!(first_enabled_installed_cli(&conn), None);
    }

    #[test]
    fn scheduler_includes_a_slot_on_the_previous_poll_boundary() {
        let schedule = parse_cron("* * * * *").unwrap();
        let now = chrono::DateTime::parse_from_rfc3339("2026-08-08T09:00:30.250Z")
            .unwrap()
            .with_timezone(&Utc);
        let previous_poll = chrono::DateTime::parse_from_rfc3339("2026-08-08T09:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let slot = latest_due_slot(&schedule, previous_poll, now).unwrap();

        assert_eq!(slot.to_rfc3339(), "2026-08-08T09:00:00+00:00");
    }

    #[test]
    fn scopes_provider_service_per_installation() {
        assert_ne!(
            scoped_provider_service("wand-github-pat", "install-a"),
            scoped_provider_service("wand-github-pat", "install-b")
        );
        assert_eq!(
            scoped_provider_service("wand-github-pat", "install-a"),
            "wand-github-pat-install-a"
        );
    }

    #[test]
    fn builds_distinct_cli_invocation_shapes() {
        assert_eq!(
            cli_args("claude", "default", "hello".into()).unwrap(),
            vec!["-p", "hello"]
        );
        assert_eq!(
            cli_args("codex", "gpt-5", "hello".into()).unwrap(),
            vec!["exec", "--model", "gpt-5", "hello"]
        );
        assert_eq!(
            cli_args("kimi", "kimi-k2", "hello".into()).unwrap(),
            vec!["--print", "--model", "kimi-k2", "hello"]
        );
        assert_eq!(
            cli_args("gemini", "gemini-2.5-pro", "hello".into()).unwrap(),
            vec!["-p", "--model", "gemini-2.5-pro", "hello"]
        );
        assert!(cli_args("unknown", "default", "hello".into()).is_err());
    }

    #[test]
    fn migrates_legacy_agents_table_before_seed() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, skills TEXT NOT NULL, color TEXT NOT NULL, built_in INTEGER NOT NULL DEFAULT 0)",[]).unwrap();
        migrate(&conn).unwrap();
        let columns:i64=conn.query_row("SELECT COUNT(*) FROM pragma_table_info('agents') WHERE name IN ('cli','model','scope')",[],|row|row.get(0)).unwrap();
        let thread_columns: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('thread_messages') WHERE name='agent_ids'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let seeded: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM agents WHERE id='planner'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(columns, 3);
        assert_eq!(thread_columns, 1);
        assert_eq!(seeded, 1);
    }

    #[test]
    fn creates_agent_transcript_storage_for_existing_databases() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let table: String = conn
            .query_row(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_transcripts'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table, "agent_transcripts");
    }

    #[test]
    fn recovers_interrupted_runs_without_disabling_recurring_tasks() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn.execute(
            "INSERT INTO tasks(id,name,repo,cron,agents,status,created_at) VALUES ('recurring','Nightly','repo','0 0 * * *','[]','running','now'),('one-off','Once','repo','one-off','[]','running','now')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO task_runs(id,task_id,scheduled_at,status) VALUES ('run-recurring','recurring','slot','running'),('run-one-off','one-off','slot','queued')",
            [],
        )
        .unwrap();

        assert_eq!(recover_interrupted_runs(&conn).unwrap(), 2);
        let recurring: String = conn
            .query_row("SELECT status FROM tasks WHERE id='recurring'", [], |row| row.get(0))
            .unwrap();
        let one_off: String = conn
            .query_row("SELECT status FROM tasks WHERE id='one-off'", [], |row| row.get(0))
            .unwrap();
        let failed_runs: i64 = conn
            .query_row("SELECT COUNT(*) FROM task_runs WHERE status='failed'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(recurring, "queued");
        assert_eq!(one_off, "failed");
        assert_eq!(failed_runs, 2);
    }

    #[test]
    fn parses_azure_pull_request_urls_without_accepting_http() {
        let parsed = parse_azure_pull_request_url(
            "https://dev.azure.com/acme/Platform/_git/wand/pullrequest/42",
        )
        .unwrap();
        assert_eq!(parsed.0, "https://dev.azure.com");
        assert_eq!(parsed.1, "Platform");
        assert_eq!(parsed.2, "wand");
        assert_eq!(parsed.3, 42);
        assert!(parse_azure_pull_request_url(
            "http://dev.azure.com/acme/Platform/_git/wand/pullrequest/42"
        )
        .is_err());
    }
}
