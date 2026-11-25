use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};
use tokio::time::{timeout, Duration};

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>;

struct Sidecar {
    child: Child,
    stdin: ChildStdin,
    pending: Pending,
    next_id: u64,
}

#[derive(Default)]
struct AppState {
    sidecar: Mutex<Option<Sidecar>>,
}

fn serve_script() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("REINS_SERVE_SCRIPT") {
        let path = PathBuf::from(path);
        if path.exists() {
            return Ok(path);
        }
        return Err(format!(
            "REINS_SERVE_SCRIPT points to a missing file: {}",
            path.display()
        ));
    }

    // CARGO_MANIFEST_DIR is apps/desktop/src-tauri at compile time.
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidates = [
        manifest.join("../../../apps/cli/dist/serve.js"),
        manifest.join("../../apps/cli/dist/serve.js"),
        PathBuf::from("apps/cli/dist/serve.js"),
        PathBuf::from("../apps/cli/dist/serve.js"),
        PathBuf::from("../../apps/cli/dist/serve.js"),
        PathBuf::from("../../../apps/cli/dist/serve.js"),
    ];
    for candidate in candidates {
        if candidate.exists() {
            return Ok(candidate.canonicalize().unwrap_or(candidate));
        }
    }
    Err(format!(
        "apps/cli/dist/serve.js not found. Run `pnpm --filter @reinss/cli build` from the repository root. Checked: {}",
        manifest.display()
    ))
}

async fn spawn_sidecar(app: Option<AppHandle>) -> Result<Sidecar, String> {
    let node = std::env::var("REINS_NODE_BIN").unwrap_or_else(|_| "node".to_string());
    let script = serve_script()?;
    let mut child = Command::new(node)
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|err| format!("Could not start the Reins sidecar: {err}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Sidecar stdin unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Sidecar stdout unavailable".to_string())?;
    let pending: Pending = Arc::default();
    let reader_pending = pending.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if let Some(id) = value.get("id").and_then(Value::as_u64) {
                if let Some(sender) = reader_pending.lock().await.remove(&id) {
                    let _ = sender.send(value);
                }
            } else if value.get("event").is_some() {
                if let Some(app) = &app {
                    let payload = value.get("data").cloned().unwrap_or(Value::Null);
                    let _ = app.emit("reins://change", payload);
                }
            }
        }
    });
    Ok(Sidecar {
        child,
        stdin,
        pending,
        next_id: 1,
    })
}

async fn request(state: &AppState, method: &str, params: Value) -> Result<Value, String> {
    let receiver = {
        let mut guard = state.sidecar.lock().await;
        let sidecar = guard
            .as_mut()
            .ok_or_else(|| "REPO_NOT_OPEN: open a repository first".to_string())?;
        let id = sidecar.next_id;
        sidecar.next_id += 1;
        let (sender, receiver) = oneshot::channel();
        sidecar.pending.lock().await.insert(id, sender);
        let payload = json!({ "id": id, "method": method, "params": params });
        let written = async {
            sidecar
                .stdin
                .write_all(format!("{payload}\n").as_bytes())
                .await?;
            sidecar.stdin.flush().await
        }
        .await;
        if let Err(err) = written {
            sidecar.pending.lock().await.remove(&id);
            return Err(format!("Sidecar write failed: {err}"));
        }
        receiver
    };

    let value = timeout(Duration::from_secs(30), receiver)
        .await
        .map_err(|_| "Sidecar request timed out".to_string())?
        .map_err(|_| "Sidecar exited".to_string())?;
    if value.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(value.get("data").cloned().unwrap_or(Value::Null));
    }
    let error = value.get("error").cloned().unwrap_or(Value::Null);
    Err(error.to_string())
}

fn envelope(data: Value) -> Value {
    json!({ "contractVersion": 1, "ok": true, "data": data })
}

fn failure(message: String) -> Value {
    json!({
        "contractVersion": 1,
        "ok": false,
        "error": { "code": "INTERNAL", "message": message, "retryable": false }
    })
}

#[tauri::command]
fn startup_repository() -> Option<String> {
    std::env::var("REINS_OPEN_REPO")
        .ok()
        .filter(|path| !path.trim().is_empty())
}

#[tauri::command]
fn startup_tool() -> Option<String> {
    std::env::var("REINS_OPEN_TOOL")
        .ok()
        .filter(|tool| !tool.trim().is_empty())
}

#[tauri::command]
fn startup_theme() -> Option<String> {
    std::env::var("REINS_THEME")
        .ok()
        .filter(|theme| theme == "light" || theme == "dark")
}

#[tauri::command]
async fn open_repository(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<Value, String> {
    {
        let mut guard = state.sidecar.lock().await;
        if let Some(mut old) = guard.take() {
            let _ = old.child.kill().await;
        }
    }
    let sidecar = spawn_sidecar(Some(app)).await?;
    *state.sidecar.lock().await = Some(sidecar);
    match request(state.inner(), "open", json!({ "root": path })).await {
        Ok(data) => Ok(envelope(data)),
        Err(message) => Ok(failure(message)),
    }
}

#[tauri::command]
async fn reins_invoke(
    state: State<'_, AppState>,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    match request(state.inner(), &method, params.unwrap_or(Value::Null)).await {
        Ok(data) => Ok(envelope(data)),
        Err(message) => Ok(failure(message)),
    }
}

#[tauri::command]
async fn close_repository(state: State<'_, AppState>) -> Result<Value, String> {
    let _ = request(state.inner(), "close", Value::Null).await;
    let mut guard = state.sidecar.lock().await;
    if let Some(mut sidecar) = guard.take() {
        let _ = sidecar.child.kill().await;
    }
    Ok(envelope(Value::Null))
}

#[tauri::command]
async fn reveal_in_editor(path: String, line: Option<u32>) -> Result<(), String> {
    let line = line.unwrap_or(1);
    let url = format!("vscode://file/{path}:{line}:1");
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open").arg(&url).status();
    #[cfg(target_os = "linux")]
    let status = std::process::Command::new("xdg-open").arg(&url).status();
    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("cmd")
        .args(["/C", "start", "", url.as_str()])
        .status();
    status
        .map_err(|err| format!("Could not open the editor: {err}"))?
        .success()
        .then_some(())
        .ok_or_else(|| "Editor command failed".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            startup_repository,
            startup_tool,
            startup_theme,
            open_repository,
            reins_invoke,
            close_repository,
            reveal_in_editor
        ])
        .run(tauri::generate_context!())
        .expect("error while running Reins");
}


#[cfg(test)]
mod tests {
    use super::{request, serve_script, spawn_sidecar, AppState};
    use serde_json::json;
    use std::path::PathBuf;

    #[test]
    fn finds_the_local_sidecar() {
        let path = serve_script().expect("serve.js should exist after pnpm build");
        assert!(path.ends_with("apps/cli/dist/serve.js"));
    }

    #[tokio::test]
    async fn opens_a_repository_through_the_sidecar() {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../test/fixtures/graph-basic")
            .canonicalize()
            .expect("fixture repository");
        let state = AppState::default();
        *state.sidecar.lock().await = Some(spawn_sidecar(None).await.expect("sidecar"));
        let data = request(&state, "open", json!({ "root": fixture }))
            .await
            .expect("open response");
        assert_eq!(data["graph"]["state"], "ready");
        assert!(data["graph"]["nodes"].as_u64().unwrap_or(0) > 0);
    }
}
