//! Local MCP server that lets each Claude session see and drive its project's services.
//!
//! It speaks the MCP "streamable HTTP" transport in its simplest form (one JSON response per POST)
//! on 127.0.0.1. Every session gets its own unguessable URL, which is how a call is tied to the
//! session that made it; nothing outside this machine can reach it.

pub mod tools;

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// Name Claude Code sees; its tools show up as `mcp__ClaudeStorm__<tool>`.
pub const SERVER_NAME: &str = "ClaudeStorm";

const MAX_BODY: usize = 1024 * 1024;

/// Port of the running server and the per-session URL tokens.
#[derive(Default)]
pub struct McpState {
    port: OnceLock<u16>,
    tokens: Mutex<HashMap<String, String>>,
    /// Approval prompts waiting for the user, by approval id.
    waiting: Mutex<HashMap<String, tokio::sync::oneshot::Sender<tools::ApprovalDecision>>>,
}

impl McpState {
    /// `--mcp-config` JSON for a session, or None while the server is not listening.
    pub fn config_for(&self, session_id: &str) -> Option<String> {
        let port = *self.port.get()?;
        let token = {
            let mut tokens = self.tokens.lock().unwrap();
            match tokens.iter().find(|(_, s)| s.as_str() == session_id) {
                Some((token, _)) => token.clone(),
                None => {
                    let token = uuid::Uuid::new_v4().simple().to_string();
                    tokens.insert(token.clone(), session_id.to_string());
                    token
                }
            }
        };
        let config = json!({ "mcpServers": { SERVER_NAME: { "type": "http", "url": format!("http://127.0.0.1:{port}/mcp/{token}") } } });
        Some(config.to_string())
    }

    fn session_for(&self, token: &str) -> Option<String> {
        self.tokens.lock().unwrap().get(token).cloned()
    }

    /// Delivers the user's answer to a waiting approval prompt; false if nothing is waiting.
    pub fn answer(&self, approval_id: &str, decision: tools::ApprovalDecision) -> bool {
        match self.waiting.lock().unwrap().remove(approval_id) {
            Some(tx) => tx.send(decision).is_ok(),
            None => false,
        }
    }

    /// Drops waiting prompts (their Claude process ended), which resolves them as denied.
    pub fn cancel(&self, approval_ids: &[String]) {
        let mut waiting = self.waiting.lock().unwrap();
        for id in approval_ids {
            waiting.remove(id);
        }
    }
}

/// Starts listening on a random loopback port; failures only disable the MCP tools.
pub fn start<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind("127.0.0.1:0").await {
            Ok(l) => l,
            Err(err) => return eprintln!("MCP server disabled: {err}"),
        };
        if let Ok(addr) = listener.local_addr() {
            let _ = app.state::<McpState>().port.set(addr.port());
        }
        loop {
            let Ok((stream, _)) = listener.accept().await else { continue };
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = serve(app, stream).await;
            });
        }
    });
}

/// Handles one HTTP request and closes the connection.
async fn serve<R: Runtime>(app: AppHandle<R>, mut stream: TcpStream) -> std::io::Result<()> {
    let Some((method, path, body)) = read_request(&mut stream).await? else {
        return respond(&mut stream, 400, None).await;
    };
    let token = path.strip_prefix("/mcp/").unwrap_or_default();
    let Some(session_id) = app.state::<McpState>().session_for(token) else {
        return respond(&mut stream, 404, None).await;
    };
    match method.as_str() {
        "POST" => {
            let Ok(message) = serde_json::from_slice::<Value>(&body) else {
                return respond(&mut stream, 400, Some(error_response(Value::Null, -32700, "Parse error"))).await;
            };
            match handle(&app, &session_id, message).await {
                Some(reply) => respond(&mut stream, 200, Some(reply)).await,
                None => respond(&mut stream, 202, None).await,
            }
        }
        // No server-initiated stream; session teardown needs no work.
        "GET" => respond(&mut stream, 405, None).await,
        "DELETE" => respond(&mut stream, 200, None).await,
        _ => respond(&mut stream, 405, None).await,
    }
}

/// Dispatches a JSON-RPC message; notifications (no id) get no reply.
async fn handle<R: Runtime>(app: &AppHandle<R>, session_id: &str, message: Value) -> Option<Value> {
    let id = message.get("id").cloned()?;
    let method = message.get("method").and_then(Value::as_str).unwrap_or_default();
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    let result = match method {
        "initialize" => {
            let version = params.get("protocolVersion").and_then(Value::as_str).unwrap_or("2025-06-18");
            json!({
                "protocolVersion": version,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION") },
                "instructions": tools::INSTRUCTIONS,
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools::definitions() }),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or_default();
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            let (text, is_error) = match tools::call(app, session_id, name, &args).await {
                Ok(text) => (text, false),
                Err(err) => (err.to_string(), true),
            };
            json!({ "content": [{ "type": "text", "text": text }], "isError": is_error })
        }
        _ => return Some(error_response(id, -32601, &format!("Method not found: {method}"))),
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Reads request line, headers and a Content-Length body.
async fn read_request(stream: &mut TcpStream) -> std::io::Result<Option<(String, String, Vec<u8>)>> {
    let mut buf = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return Ok(None);
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos;
        }
        if buf.len() > MAX_BODY {
            return Ok(None);
        }
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.lines();
    let mut first = lines.next().unwrap_or_default().split_whitespace();
    let (method, path) = (first.next().unwrap_or_default().to_string(), first.next().unwrap_or_default().to_string());
    let length = lines
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.trim().parse::<usize>().ok())
        .unwrap_or(0);
    if length > MAX_BODY {
        return Ok(None);
    }
    let mut body = buf[header_end + 4..].to_vec();
    while body.len() < length {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(length);
    Ok(Some((method, path, body)))
}

async fn respond(stream: &mut TcpStream, status: u16, body: Option<Value>) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "Method Not Allowed",
    };
    let payload = body.map(|b| b.to_string()).unwrap_or_default();
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len()
    );
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(payload.as_bytes()).await?;
    stream.flush().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::*;
    use crate::process_manager::ProcessManager;
    use crate::sessions::manager::SessionManager;
    use crate::store::Store;
    use crate::usage::service::UsageService;
    use chrono::Utc;

    /// Mock app with a project (one repo serving `python3 -m http.server`) and a direct session.
    fn app_with_session(root: &std::path::Path, port: u16) -> (tauri::App<tauri::test::MockRuntime>, String) {
        let repo = root.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        crate::git::run_git(&repo, &["init", "-q"]).unwrap();
        let app = tauri::test::mock_builder()
            .manage(McpState::default())
            .manage(ProcessManager::default())
            .manage(SessionManager::default())
            .manage(UsageService::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        app.handle().manage(Store::load(root.join("data")).unwrap());
        let session_id = new_id();
        let sid = session_id.clone();
        app.handle()
            .state::<Store>()
            .write(|d| {
                d.projects.push(Project {
                    id: "p".into(),
                    name: "mcp".into(),
                    created_at: Utc::now(),
                    last_opened_at: None,
                    repos: vec![Repo {
                        id: "r".into(),
                        name: "web".into(),
                        path: repo.to_string_lossy().to_string(),
                        framework: Framework::Generic,
                        package_manager: None,
                        port: Some(port),
                        commands: vec![RepoCommand {
                            id: "c".into(),
                            label: "dev".into(),
                            command: format!("python3 -m http.server {port}"),
                            long_running: true,
                        }],
                    }],
                    account_id: Some("acc".into()),
                    color: None,
                    layout: Vec::new(),
                    ui_state: None,
                });
                d.accounts.push(ClaudeAccount {
                    id: "acc".into(),
                    alias: "este equipo".into(),
                    kind: AccountKind::SystemLogin,
                    token_hint: None,
                    default_model: None,
                    created_at: Utc::now(),
                    login_email: None,
                    needs_login: false,
                });
                d.sessions.push(Session {
                    id: sid,
                    project_id: "p".into(),
                    title: "mcp".into(),
                    description: None,
                    profile_id: None,
                    model: Some("haiku".into()),
                    permission_mode: "acceptEdits".into(),
                    repo_ids: vec!["r".into()],
                    mode: SessionMode::Direct,
                    branch: None,
                    status: SessionStatus::Idle,
                    claude_session_id: uuid::Uuid::new_v4().to_string(),
                    has_conversation: false,
                    created_at: Utc::now(),
                    last_activity_at: Utc::now(),
                    summary: None,
                    files_touched: vec![],
                    archived: false,
                    last_error: None,
                    base_branches: Default::default(),
                    last_model: None,
                    pending: Vec::new(),
        approvals: Vec::new(),
        allowed_tools: Vec::new(),
                });
                Ok(())
            })
            .unwrap();
        (app, session_id)
    }

    /// Sends one JSON-RPC message over real HTTP and parses the reply.
    async fn post(url: &str, body: Value) -> (u16, Option<Value>) {
        let res = reqwest::Client::new().post(url).json(&body).send().await.unwrap();
        let status = res.status().as_u16();
        let text = res.text().await.unwrap();
        (status, serde_json::from_str(&text).ok())
    }

    async fn url_for(app: &tauri::App<tauri::test::MockRuntime>, session_id: &str) -> String {
        start(app.handle().clone());
        for _ in 0..50 {
            if let Some(cfg) = app.handle().state::<McpState>().config_for(session_id) {
                let v: Value = serde_json::from_str(&cfg).unwrap();
                return v["mcpServers"][SERVER_NAME]["url"].as_str().unwrap().to_string();
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        panic!("server did not start");
    }

    #[tokio::test]
    async fn speaks_mcp_over_http_and_runs_services() {
        let root = std::env::temp_dir().join(format!("claude-storm-mcp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let port = 47_000 + (std::process::id() % 1000) as u16;
        let (app, session_id) = app_with_session(&root, port);
        let url = url_for(&app, &session_id).await;

        let (status, reply) = post(&url, json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}})).await;
        assert_eq!(status, 200);
        assert_eq!(reply.unwrap()["result"]["serverInfo"]["name"], SERVER_NAME);
        let (status, reply) = post(&url, json!({"jsonrpc":"2.0","method":"notifications/initialized"})).await;
        assert_eq!((status, reply), (202, None));
        let (_, reply) = post(&url, json!({"jsonrpc":"2.0","id":2,"method":"tools/list"})).await;
        assert_eq!(reply.unwrap()["result"]["tools"].as_array().unwrap().len(), 7);

        let wrong = url.rsplit_once('/').unwrap().0.to_string() + "/nope";
        assert_eq!(post(&wrong, json!({"jsonrpc":"2.0","id":3,"method":"ping"})).await.0, 404);

        let call = |name: &str, args: Value| json!({"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":name,"arguments":args}});
        let (_, reply) = post(&url, call("service_start", json!({"repo":"web","command":"dev","wait_seconds":20}))).await;
        let text = reply.unwrap()["result"]["content"][0]["text"].as_str().unwrap().to_string();
        assert!(text.contains(&format!("answering on http://localhost:{port}")), "{text}");

        let (_, reply) = post(&url, call("services_list", json!({}))).await;
        assert!(reply.unwrap()["result"]["content"][0]["text"].as_str().unwrap().contains("\"startedBy\": \"you\""));

        let (_, reply) = post(&url, call("service_stop", json!({"repo":"web","command":"dev"}))).await;
        assert_eq!(reply.unwrap()["result"]["isError"], false);
        app.handle().state::<ProcessManager>().kill_all_blocking();
        let _ = std::fs::remove_dir_all(root);
    }

    /// Real Claude Code run (costs a few cents of haiku): `cargo test mcp_e2e -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn mcp_e2e() {
        let root = std::env::temp_dir().join(format!("claude-storm-mcp-e2e-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let port = 48_000 + (std::process::id() % 1000) as u16;
        let (app, session_id) = app_with_session(&root, port);
        let handle = app.handle().clone();
        url_for(&app, &session_id).await;
        handle
            .state::<SessionManager>()
            .send(&handle, &session_id, "Levanta el servicio dev del repo web con la herramienta de ClaudeStorm y dime solo la URL donde responde.".into(), None, vec![])
            .unwrap();
        for _ in 0..240 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let s = handle.state::<Store>().session(&session_id).unwrap();
            if !matches!(s.status, SessionStatus::Working | SessionStatus::Queued) {
                break;
            }
        }
        let procs = handle.state::<ProcessManager>().list("p");
        let history = crate::sessions::history::History::new(&root.join("data")).read(&session_id).unwrap();
        println!("{history:#?}");
        assert!(procs.iter().any(|p| p.started_by.as_deref() == Some(session_id.as_str())), "Claude did not start the service: {procs:?}");
        handle.state::<ProcessManager>().kill_all_blocking();
        let _ = std::fs::remove_dir_all(root);
    }

    /// Queued messages, auto-flush and "Enviar ya" against real Claude Code (haiku, a few cents):
    /// `cargo test queue_e2e -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn queue_e2e() {
        let root = std::env::temp_dir().join(format!("claude-storm-queue-e2e-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (app, session_id) = app_with_session(&root, 49_000);
        let handle = app.handle().clone();
        let manager = handle.state::<SessionManager>();
        let store = handle.state::<Store>();
        let wait_idle = || async {
            for _ in 0..240 {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                let s = handle.state::<Store>().session(&session_id).unwrap();
                if !matches!(s.status, SessionStatus::Working | SessionStatus::Queued) {
                    return s;
                }
            }
            panic!("session never finished");
        };

        // 1) A message sent while working is queued, then goes out by itself when the turn ends.
        manager.send(&handle, &session_id, "Responde solo: uno".into(), None, vec![]).unwrap();
        let queued = manager.send(&handle, &session_id, "Responde solo: dos".into(), None, vec![]).unwrap();
        assert_eq!(queued.pending.len(), 1);
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let s = wait_idle().await;
        assert!(s.pending.is_empty(), "queue was not flushed");
        let prompts = |h: &Vec<crate::sessions::stream::ChatItem>| h.iter().filter(|i| matches!(i, crate::sessions::stream::ChatItem::Prompt { .. })).count();
        let history = crate::sessions::history::History::new(&store.dir()).read(&session_id).unwrap();
        assert_eq!(prompts(&history), 2);

        // 2) "Enviar ya" interrupts a long turn and sends the queued message right away.
        manager.send(&handle, &session_id, "Cuenta del 1 al 300, un número por línea.".into(), None, vec![]).unwrap();
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        manager.send(&handle, &session_id, "Olvida eso. Responde solo: tres".into(), None, vec![]).unwrap();
        manager.send_now(&handle, &session_id).await.unwrap();
        let s = wait_idle().await;
        let history = crate::sessions::history::History::new(&store.dir()).read(&session_id).unwrap();
        println!("{history:#?}");
        assert!(s.pending.is_empty());
        assert_eq!(prompts(&history), 4);
        assert!(history.iter().any(|i| matches!(i, crate::sessions::stream::ChatItem::Notice { text, .. } if text.contains("Interrupted"))));
        let _ = std::fs::remove_dir_all(root);
    }

    /// Permission prompts and AskUserQuestion answered through ClaudeStorm (haiku, a few cents):
    /// `cargo test approvals_e2e -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn approvals_e2e() {
        let root = std::env::temp_dir().join(format!("claude-storm-approvals-e2e-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (app, session_id) = app_with_session(&root, 49_100);
        let handle = app.handle().clone();
        url_for(&app, &session_id).await;
        let repo = root.join("repo");

        // Answers every prompt that shows up: allows Bash, picks "Azul" for questions.
        let seen = std::sync::Arc::new(Mutex::new(Vec::<String>::new()));
        let (h2, sid2, seen2) = (handle.clone(), session_id.clone(), seen.clone());
        let responder = tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                let Ok(s) = h2.state::<Store>().session(&sid2) else { continue };
                for a in s.approvals {
                    seen2.lock().unwrap().push(a.tool_name.clone());
                    let decision = if a.tool_name == "AskUserQuestion" {
                        let q = a.input["questions"][0]["question"].as_str().unwrap_or_default().to_string();
                        let mut answers = serde_json::Map::new();
                        answers.insert(q, json!("Azul"));
                        tools::ApprovalDecision { allow: true, answers: Some(answers), ..Default::default() }
                    } else {
                        tools::ApprovalDecision { allow: true, ..Default::default() }
                    };
                    h2.state::<McpState>().answer(&a.id, decision);
                }
            }
        });
        let wait_idle = || async {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            for _ in 0..240 {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                let s = handle.state::<Store>().session(&session_id).unwrap();
                if !matches!(s.status, SessionStatus::Working | SessionStatus::Queued) {
                    return;
                }
            }
            panic!("session never finished");
        };
        let manager = handle.state::<SessionManager>();
        manager
            .send(&handle, &session_id, "Ejecuta exactamente este comando con Bash: mkdir -p aprobado && echo ok > aprobado/listo.txt".into(), None, vec![])
            .unwrap();
        wait_idle().await;
        assert!(repo.join("aprobado/listo.txt").exists(), "the approved command did not run; prompts seen: {:?}", seen.lock().unwrap());

        manager
            .send(&handle, &session_id, "Usa WebFetch para leer https://example.com y dime solo el título de la página.".into(), None, vec![])
            .unwrap();
        wait_idle().await;
        assert!(seen.lock().unwrap().iter().any(|t| t == "WebFetch"), "WebFetch did not ask: {:?}", seen.lock().unwrap());

        manager
            .send(&handle, &session_id, "Usa la herramienta AskUserQuestion para preguntarme mi color favorito con las opciones Rojo y Azul. Después dime solo el color que elegí.".into(), None, vec![])
            .unwrap();
        wait_idle().await;
        responder.abort();
        let history = crate::sessions::history::History::new(&root.join("data")).read(&session_id).unwrap();
        let last = history.iter().rev().find_map(|i| match i {
            crate::sessions::stream::ChatItem::Result { text, .. } => Some(text.clone()),
            _ => None,
        });
        println!("prompts seen: {:?}\nlast answer: {last:?}", seen.lock().unwrap());
        assert!(seen.lock().unwrap().iter().any(|t| t == "AskUserQuestion"));
        assert!(last.unwrap_or_default().to_lowercase().contains("azul"));
        let _ = std::fs::remove_dir_all(root);
    }
}
