use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Root document persisted in the app data dir.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default)]
    pub jira: Option<JiraSettings>,
    #[serde(default)]
    pub sessions: Vec<Session>,
    #[serde(default)]
    pub accounts: Vec<ClaudeAccount>,
    #[serde(default)]
    pub settings: AppSettings,
}

/// Global preferences.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_max_parallel")]
    pub max_parallel_sessions: usize,
    #[serde(default = "crate::usage::models::fallback_catalog")]
    pub model_catalog: Vec<crate::usage::models::CatalogModel>,
    #[serde(default)]
    pub catalog_updated_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub disabled_models: Vec<String>,
    #[serde(default)]
    pub default_model: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            max_parallel_sessions: default_max_parallel(),
            model_catalog: crate::usage::models::fallback_catalog(),
            catalog_updated_at: None,
            disabled_models: Vec::new(),
            default_model: None,
        }
    }
}

/// How a Claude account authenticates.
///
/// `Profile` accounts are isolated Claude Code config dirs where Claude Code itself performs and
/// stores the login; claude-storm never touches those credentials. `OauthToken` only exists to migrate
/// data from older versions and is converted to `Profile` on load.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AccountKind {
    Profile,
    ApiKey,
    SystemLogin,
    OauthToken,
}

/// A Claude account usable by projects (global to the app).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAccount {
    pub id: String,
    pub alias: String,
    pub kind: AccountKind,
    #[serde(default)]
    pub token_hint: Option<String>,
    #[serde(default)]
    pub default_model: Option<String>,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub login_email: Option<String>,
    #[serde(default)]
    pub needs_login: bool,
}

fn default_max_parallel() -> usize {
    3
}

/// Lifecycle of a Claude session as shown on its card.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionStatus {
    Idle,
    Queued,
    Working,
    Waiting,
    Done,
    Error,
    Interrupted,
}

/// Whether the session edits the repos in place or inside its own git worktrees.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionMode {
    Direct,
    Isolated,
}

/// A parallel Claude Code conversation inside a project; its history lives in its own file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub project_id: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    pub permission_mode: String,
    pub repo_ids: Vec<String>,
    pub mode: SessionMode,
    #[serde(default)]
    pub branch: Option<String>,
    pub status: SessionStatus,
    pub claude_session_id: String,
    #[serde(default)]
    pub has_conversation: bool,
    pub created_at: DateTime<Utc>,
    pub last_activity_at: DateTime<Utc>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub files_touched: Vec<String>,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub last_error: Option<String>,
    #[serde(default)]
    pub base_branches: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub last_model: Option<String>,
}

fn default_version() -> u32 {
    1
}

/// A named group of repositories opened together in its own window.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub last_opened_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub repos: Vec<Repo>,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub layout: Vec<LayoutItem>,
}

/// Top-level entry of a project's repo tree: a loose repo or a one-level group of repos.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum LayoutItem {
    #[serde(rename_all = "camelCase")]
    Repo { repo_id: String },
    #[serde(rename_all = "camelCase")]
    Group { id: String, name: String, #[serde(default)] collapsed: bool, repo_ids: Vec<String> },
}

impl Project {
    /// Layout with unknown or duplicated repos removed and new repos appended at the end.
    pub fn normalized_layout(&self) -> Vec<LayoutItem> {
        let known: std::collections::HashSet<&str> = self.repos.iter().map(|r| r.id.as_str()).collect();
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for item in &self.layout {
            match item {
                LayoutItem::Repo { repo_id } => {
                    if known.contains(repo_id.as_str()) && seen.insert(repo_id.clone()) {
                        out.push(item.clone());
                    }
                }
                LayoutItem::Group { id, name, collapsed, repo_ids } => {
                    let ids: Vec<String> =
                        repo_ids.iter().filter(|r| known.contains(r.as_str()) && seen.insert((*r).clone())).cloned().collect();
                    out.push(LayoutItem::Group { id: id.clone(), name: name.clone(), collapsed: *collapsed, repo_ids: ids });
                }
            }
        }
        for repo in &self.repos {
            if seen.insert(repo.id.clone()) {
                out.push(LayoutItem::Repo { repo_id: repo.id.clone() });
            }
        }
        out
    }
}

/// A git repository registered in a project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub framework: Framework,
    pub package_manager: Option<String>,
    pub port: Option<u16>,
    #[serde(default)]
    pub commands: Vec<RepoCommand>,
}

/// Frameworks claude-storm knows how to preconfigure.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Framework {
    Next,
    Vite,
    React,
    Expo,
    Laravel,
    Node,
    Generic,
}

/// An editable shell command attached to a repo.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoCommand {
    pub id: String,
    pub label: String,
    pub command: String,
    pub long_running: bool,
}

/// Non-secret Jira settings; the API token lives in the OS keychain.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraSettings {
    pub site_url: String,
    pub email: String,
}

/// Lightweight project row used by the welcome window.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub repo_count: usize,
    pub root_hint: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_opened_at: Option<DateTime<Utc>>,
    pub is_open: bool,
}

/// Returns the deepest directory shared by every repo path, used as a subtitle.
pub fn common_root(paths: &[&str]) -> Option<String> {
    let first = std::path::Path::new(paths.first()?);
    let mut root = if paths.len() == 1 { first.to_path_buf() } else { first.parent()?.to_path_buf() };
    while !paths.iter().all(|p| std::path::Path::new(p).starts_with(&root)) {
        root = root.parent()?.to_path_buf();
    }
    let text = root.to_string_lossy().to_string();
    (!text.is_empty() && text != "/").then_some(text)
}

/// Generates a new random identifier.
pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::common_root;

    #[test]
    fn common_root_of_siblings_is_parent() {
        let paths = ["/www/acme/api", "/www/acme/web"];
        assert_eq!(common_root(&paths).as_deref(), Some("/www/acme"));
    }

    #[test]
    fn common_root_of_single_repo_is_itself() {
        assert_eq!(common_root(&["/www/acme/api"]).as_deref(), Some("/www/acme/api"));
    }

    #[test]
    fn layout_drops_unknown_and_appends_new_repos() {
        use super::{Framework, LayoutItem, Project, Repo};
        let repo = |id: &str| Repo {
            id: id.into(),
            name: id.into(),
            path: format!("/{id}"),
            framework: Framework::Generic,
            package_manager: None,
            port: None,
            commands: vec![],
        };
        let project = Project {
            id: "p".into(),
            name: "p".into(),
            created_at: chrono::Utc::now(),
            last_opened_at: None,
            repos: vec![repo("a"), repo("b"), repo("c")],
            account_id: None,
            color: None,
            layout: vec![
                LayoutItem::Group { id: "g".into(), name: "G".into(), collapsed: false, repo_ids: vec!["b".into(), "gone".into()] },
                LayoutItem::Repo { repo_id: "b".into() },
                LayoutItem::Repo { repo_id: "a".into() },
            ],
        };
        assert_eq!(
            project.normalized_layout(),
            vec![
                LayoutItem::Group { id: "g".into(), name: "G".into(), collapsed: false, repo_ids: vec!["b".into()] },
                LayoutItem::Repo { repo_id: "a".into() },
                LayoutItem::Repo { repo_id: "c".into() },
            ]
        );
    }

    #[test]
    fn common_root_of_unrelated_paths_is_none() {
        assert_eq!(common_root(&["/a/x", "/b/y"]), None);
        assert_eq!(common_root(&[]), None);
    }
}
