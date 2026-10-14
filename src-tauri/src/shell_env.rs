use std::collections::HashMap;
use std::process::Command;
use std::sync::OnceLock;

const MARKER: &str = "__DEVHUB_ENV__";

/// Environment captured from the user's login shell.
///
/// GUI apps on macOS do not inherit the PATH configured in shell profiles, so tools such as
/// node, php or claude would not be found without this.
pub fn login_env() -> &'static HashMap<String, String> {
    static ENV: OnceLock<HashMap<String, String>> = OnceLock::new();
    ENV.get_or_init(|| capture_login_env().unwrap_or_else(|| std::env::vars().collect()))
}

/// Runs the login shell once and parses its environment.
#[cfg(unix)]
fn capture_login_env() -> Option<HashMap<String, String>> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let script = format!("printf '{MARKER}'; env -0");
    let output = Command::new(shell).args(["-ilc", &script]).output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let body = text.split_once(MARKER)?.1;
    let env: HashMap<String, String> = body
        .split('\0')
        .filter_map(|pair| pair.split_once('=').map(|(k, v)| (k.to_string(), v.to_string())))
        .collect();
    env.contains_key("PATH").then_some(env)
}

/// Windows GUI processes already inherit the user environment.
#[cfg(windows)]
fn capture_login_env() -> Option<HashMap<String, String>> {
    None
}

/// Builds a std command preloaded with the login environment.
pub fn command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.env_clear().envs(login_env());
    cmd
}

/// Builds a tokio command preloaded with the login environment.
pub fn async_command(program: &str) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program);
    cmd.env_clear().envs(login_env());
    cmd
}

/// Returns the program and arguments that run a command line through the platform shell.
pub fn shell_invocation(command_line: &str) -> (String, Vec<String>) {
    if cfg!(windows) {
        ("cmd".into(), vec!["/C".into(), command_line.into()])
    } else {
        let shell = login_env().get("SHELL").cloned().unwrap_or_else(|| "/bin/sh".into());
        (shell, vec!["-c".into(), command_line.into()])
    }
}

/// Resolves an executable name against the login PATH.
pub fn which(program: &str) -> Option<std::path::PathBuf> {
    let path = login_env().get("PATH").or_else(|| login_env().get("Path"))?;
    let exts: Vec<&str> = if cfg!(windows) { vec![".exe", ".cmd", ".bat", ""] } else { vec![""] };
    std::env::split_paths(path).find_map(|dir| {
        exts.iter().map(|ext| dir.join(format!("{program}{ext}"))).find(|p| p.is_file())
    })
}
