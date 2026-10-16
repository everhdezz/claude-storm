use std::fs;
use std::path::Path;

use regex::Regex;
use serde_json::Value;

use crate::models::{new_id, Framework, RepoCommand};

/// Result of inspecting a folder: framework, package manager, port and suggested commands.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub framework: Framework,
    pub package_manager: Option<String>,
    pub port: Option<u16>,
    pub commands: Vec<RepoCommand>,
}

/// Detects the framework of a repository and preloads editable commands.
///
/// Frameworks with an unambiguous marker go first, so a Django or Rails app that also has a
/// package.json for its assets is not taken for a Node project; plain languages go last.
pub fn detect(dir: &Path) -> Detection {
    let detectors: [fn(&Path) -> Option<Detection>; 14] = [
        detect_godot,
        detect_laravel,
        detect_symfony,
        detect_django,
        detect_rails,
        detect_phoenix,
        detect_flutter,
        detect_node,
        detect_deno,
        detect_rust,
        detect_go,
        detect_python,
        detect_jvm,
        detect_dotnet,
    ];
    detectors
        .iter()
        .find_map(|detect| detect(dir))
        .or_else(|| detect_php(dir))
        .unwrap_or(Detection { framework: Framework::Generic, package_manager: None, port: None, commands: Vec::new() })
}

/// Builds a command entry.
fn cmd(label: &str, command: String, long_running: bool) -> RepoCommand {
    RepoCommand { id: new_id(), label: label.into(), command, long_running }
}

/// Reads a text file, if present.
fn read_text(path: &Path) -> Option<String> {
    fs::read_to_string(path).ok()
}

/// Whether the file exists and its text contains `needle`.
fn file_contains(path: &Path, needle: &str) -> bool {
    read_text(path).is_some_and(|text| text.contains(needle))
}

/// Reads and parses a JSON file, if present.
fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

/// Detects a Laravel app through composer.json and the artisan script.
fn detect_laravel(dir: &Path) -> Option<Detection> {
    let composer = read_json(&dir.join("composer.json"))?;
    let is_laravel = composer.pointer("/require/laravel~1framework").is_some() && dir.join("artisan").is_file();
    if !is_laravel {
        return None;
    }
    let port = laravel_port(dir).unwrap_or(8000);
    Some(Detection {
        framework: Framework::Laravel,
        package_manager: Some("composer".into()),
        port: Some(port),
        commands: vec![
            cmd("serve", format!("php artisan serve --port={port}"), true),
            cmd("migrate", "php artisan migrate".into(), false),
            cmd("install", "composer install".into(), false),
        ],
    })
}

/// Reads the port from APP_URL in .env when it is a localhost URL with an explicit port.
fn laravel_port(dir: &Path) -> Option<u16> {
    let env = fs::read_to_string(dir.join(".env")).ok()?;
    let re = Regex::new(r"(?m)^APP_URL=.*(?:localhost|127\.0\.0\.1):(\d{2,5})").ok()?;
    re.captures(&env)?.get(1)?.as_str().parse().ok()
}

/// Detects a Symfony app through its framework bundle.
fn detect_symfony(dir: &Path) -> Option<Detection> {
    let composer = read_json(&dir.join("composer.json"))?;
    composer.pointer("/require/symfony~1framework-bundle")?;
    Some(Detection {
        framework: Framework::Symfony,
        package_manager: Some("composer".into()),
        port: Some(8000),
        commands: vec![
            cmd("serve", "php -S localhost:8000 -t public".into(), true),
            cmd("migrate", "php bin/console doctrine:migrations:migrate --no-interaction".into(), false),
            cmd("install", "composer install".into(), false),
        ],
    })
}

/// Detects any other Composer project; serves `public/` when it has one.
fn detect_php(dir: &Path) -> Option<Detection> {
    if !dir.join("composer.json").is_file() {
        return None;
    }
    let mut commands = Vec::new();
    let docroot = if dir.join("public/index.php").is_file() { Some("public") } else if dir.join("index.php").is_file() { Some(".") } else { None };
    if let Some(root) = docroot {
        commands.push(cmd("serve", format!("php -S localhost:8000 -t {root}"), true));
    }
    commands.push(cmd("install", "composer install".into(), false));
    Some(Detection { framework: Framework::Php, package_manager: Some("composer".into()), port: docroot.map(|_| 8000), commands })
}

/// Detects a Godot project through project.godot, at the repo root or in a direct subfolder
/// (e.g. `godot/` next to tools and docs).
fn detect_godot(dir: &Path) -> Option<Detection> {
    let project = godot_project_dir(dir)?;
    let path = if project.is_empty() { ".".to_string() } else if project.contains(' ') { format!("\"{project}\"") } else { project };
    Some(Detection {
        framework: Framework::Godot,
        package_manager: None,
        port: None,
        commands: vec![
            cmd("run", format!("godot --path {path}"), true),
            cmd("editor", format!("godot --editor --path {path}"), true),
            cmd("import", format!("godot --headless --import --path {path}"), false),
        ],
    })
}

/// Folder holding project.godot relative to `dir` ("" for `dir` itself), searched one level deep.
fn godot_project_dir(dir: &Path) -> Option<String> {
    if dir.join("project.godot").is_file() {
        return Some(String::new());
    }
    let mut found: Vec<String> = fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .filter(|e| e.path().join("project.godot").is_file())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| !name.starts_with('.') && name != "node_modules")
        .collect();
    found.sort();
    found.into_iter().next()
}

/// Detects a Rust crate or workspace through Cargo.toml.
fn detect_rust(dir: &Path) -> Option<Detection> {
    let manifest = read_text(&dir.join("Cargo.toml"))?;
    let mut commands = Vec::new();
    // A pure workspace has nothing to `cargo run` without picking a member.
    if manifest.contains("[package]") {
        commands.push(cmd("run", "cargo run".into(), true));
    }
    commands.push(cmd("build", "cargo build".into(), false));
    commands.push(cmd("test", "cargo test".into(), false));
    Some(Detection { framework: Framework::Rust, package_manager: Some("cargo".into()), port: None, commands })
}

/// Detects a Go module through go.mod.
fn detect_go(dir: &Path) -> Option<Detection> {
    if !dir.join("go.mod").is_file() {
        return None;
    }
    Some(Detection {
        framework: Framework::Go,
        package_manager: Some("go".into()),
        port: None,
        commands: vec![
            cmd("run", "go run .".into(), true),
            cmd("build", "go build ./...".into(), false),
            cmd("test", "go test ./...".into(), false),
        ],
    })
}

/// Python tool that manages the project's environment, from its lockfile.
fn python_manager(dir: &Path) -> &'static str {
    if dir.join("uv.lock").exists() {
        "uv"
    } else if dir.join("poetry.lock").exists() {
        "poetry"
    } else if dir.join("Pipfile").exists() {
        "pipenv"
    } else {
        "pip"
    }
}

/// Prefix that runs a command inside the project's Python environment.
fn python_run(pm: &str) -> &'static str {
    match pm {
        "uv" => "uv run ",
        "poetry" => "poetry run ",
        "pipenv" => "pipenv run ",
        _ => "",
    }
}

/// Command that installs the project's Python dependencies, if it declares any.
fn python_install(dir: &Path, pm: &str) -> Option<RepoCommand> {
    let command = match pm {
        "uv" => "uv sync".into(),
        "poetry" => "poetry install".into(),
        "pipenv" => "pipenv install".into(),
        _ if dir.join("requirements.txt").is_file() => "pip install -r requirements.txt".into(),
        _ if dir.join("pyproject.toml").is_file() => "pip install -e .".into(),
        _ => return None,
    };
    Some(cmd("install", command, false))
}

/// Whether the Python project declares `package` as a dependency.
fn python_depends_on(dir: &Path, package: &str) -> bool {
    let re = Regex::new(&format!(r#"(?im)^\s*["']?{package}\b"#)).expect("valid regex");
    ["requirements.txt", "pyproject.toml", "Pipfile"]
        .iter()
        .filter_map(|f| read_text(&dir.join(f)))
        .any(|text| re.is_match(&text))
}

/// Detects a Django app through manage.py.
fn detect_django(dir: &Path) -> Option<Detection> {
    if !file_contains(&dir.join("manage.py"), "django") {
        return None;
    }
    let pm = python_manager(dir);
    let run = python_run(pm);
    let mut commands = vec![
        cmd("runserver", format!("{run}python manage.py runserver 8000"), true),
        cmd("migrate", format!("{run}python manage.py migrate"), false),
    ];
    commands.extend(python_install(dir, pm));
    Some(Detection { framework: Framework::Django, package_manager: Some(pm.into()), port: Some(8000), commands })
}

/// Detects Flask, FastAPI or a plain Python project.
fn detect_python(dir: &Path) -> Option<Detection> {
    let declared = ["pyproject.toml", "requirements.txt", "Pipfile", "setup.py"].iter().any(|f| dir.join(f).is_file());
    if !declared && !dir.join("main.py").is_file() {
        return None;
    }
    let pm = python_manager(dir);
    let run = python_run(pm);
    let (framework, port, serve) = if python_depends_on(dir, "fastapi") {
        (Framework::Fastapi, Some(8000), Some(cmd("dev", format!("{run}fastapi dev --port 8000"), true)))
    } else if python_depends_on(dir, "flask") {
        (Framework::Flask, Some(5000), Some(cmd("run", format!("{run}flask run --debug --port 5000"), true)))
    } else {
        let main = dir.join("main.py").is_file().then(|| cmd("run", format!("{run}python main.py"), true));
        (Framework::Python, None, main)
    };
    let mut commands: Vec<RepoCommand> = serve.into_iter().collect();
    commands.extend(python_install(dir, pm));
    Some(Detection { framework, package_manager: Some(pm.into()), port, commands })
}

/// Detects a Rails app through its Gemfile and bin/rails.
fn detect_rails(dir: &Path) -> Option<Detection> {
    if !file_contains(&dir.join("Gemfile"), "rails") || !dir.join("bin/rails").is_file() {
        return None;
    }
    Some(Detection {
        framework: Framework::Rails,
        package_manager: Some("bundler".into()),
        port: Some(3000),
        commands: vec![
            cmd("server", "bin/rails server -p 3000".into(), true),
            cmd("migrate", "bin/rails db:migrate".into(), false),
            cmd("install", "bundle install".into(), false),
        ],
    })
}

/// Detects a Phoenix app through mix.exs.
fn detect_phoenix(dir: &Path) -> Option<Detection> {
    if !file_contains(&dir.join("mix.exs"), ":phoenix") {
        return None;
    }
    Some(Detection {
        framework: Framework::Phoenix,
        package_manager: Some("mix".into()),
        port: Some(4000),
        commands: vec![
            cmd("server", "mix phx.server".into(), true),
            cmd("migrate", "mix ecto.migrate".into(), false),
            cmd("install", "mix deps.get".into(), false),
        ],
    })
}

/// Detects a Flutter app through pubspec.yaml.
fn detect_flutter(dir: &Path) -> Option<Detection> {
    if !file_contains(&dir.join("pubspec.yaml"), "flutter") {
        return None;
    }
    Some(Detection {
        framework: Framework::Flutter,
        package_manager: Some("pub".into()),
        port: None,
        commands: vec![
            cmd("run", "flutter run".into(), true),
            cmd("test", "flutter test".into(), false),
            cmd("install", "flutter pub get".into(), false),
        ],
    })
}

/// Detects a .NET project or solution in the folder.
fn detect_dotnet(dir: &Path) -> Option<Detection> {
    let has_project = fs::read_dir(dir).ok()?.flatten().any(|e| {
        let name = e.file_name().to_string_lossy().to_lowercase();
        name.ends_with(".csproj") || name.ends_with(".fsproj") || name.ends_with(".sln") || name.ends_with(".slnx")
    });
    if !has_project {
        return None;
    }
    Some(Detection {
        framework: Framework::Dotnet,
        package_manager: Some("dotnet".into()),
        port: None,
        commands: vec![
            cmd("watch", "dotnet watch".into(), true),
            cmd("build", "dotnet build".into(), false),
            cmd("test", "dotnet test".into(), false),
        ],
    })
}

/// Detects a Maven or Gradle project, as Spring Boot when it uses it.
fn detect_jvm(dir: &Path) -> Option<Detection> {
    let maven = dir.join("pom.xml");
    let gradle = ["build.gradle.kts", "build.gradle"].iter().map(|f| dir.join(f)).find(|p| p.is_file());
    let (build_file, tool) = match (maven.is_file(), gradle) {
        (true, _) => (maven, "maven"),
        (false, Some(g)) => (g, "gradle"),
        _ => return None,
    };
    let spring = file_contains(&build_file, "spring-boot");
    let bin = match tool {
        "maven" if dir.join("mvnw").is_file() => "./mvnw",
        "maven" => "mvn",
        _ if dir.join("gradlew").is_file() => "./gradlew",
        _ => "gradle",
    };
    let mut commands = Vec::new();
    if spring {
        let run = if tool == "maven" { "spring-boot:run" } else { "bootRun" };
        commands.push(cmd("run", format!("{bin} {run}"), true));
    }
    let (build, test) = if tool == "maven" { ("package", "test") } else { ("build", "test") };
    commands.push(cmd("build", format!("{bin} {build}"), false));
    commands.push(cmd("test", format!("{bin} {test}"), false));
    Some(Detection {
        framework: if spring { Framework::Spring } else { Framework::Java },
        package_manager: Some(tool.into()),
        port: spring.then_some(8080),
        commands,
    })
}

/// Detects a Deno project through deno.json, running its `dev` or `start` task.
fn detect_deno(dir: &Path) -> Option<Detection> {
    let config = ["deno.json", "deno.jsonc"].iter().find_map(|f| read_text(&dir.join(f)))?;
    let mut commands = Vec::new();
    if let Some(task) = ["dev", "start"].into_iter().find(|t| config.contains(&format!("\"{t}\""))) {
        commands.push(cmd(task, format!("deno task {task}"), true));
    }
    commands.push(cmd("install", "deno install".into(), false));
    Some(Detection { framework: Framework::Deno, package_manager: Some("deno".into()), port: None, commands })
}

/// Detects Node-based projects, from meta-frameworks down to plain Node.
fn detect_node(dir: &Path) -> Option<Detection> {
    let pkg = read_json(&dir.join("package.json"))?;
    let has_dep = |name: &str| {
        ["dependencies", "devDependencies"].iter().any(|k| pkg.get(k).and_then(|d| d.get(name)).is_some())
    };
    // Meta-frameworks before the libraries and bundlers they are built on.
    let framework = if has_dep("expo") {
        Framework::Expo
    } else if has_dep("next") {
        Framework::Next
    } else if has_dep("nuxt") {
        Framework::Nuxt
    } else if has_dep("@sveltejs/kit") || has_dep("svelte") {
        Framework::Svelte
    } else if has_dep("astro") {
        Framework::Astro
    } else if has_dep("@angular/core") {
        Framework::Angular
    } else if has_dep("gatsby") {
        Framework::Gatsby
    } else if has_dep("@nestjs/core") {
        Framework::Nest
    } else if has_dep("vue") {
        Framework::Vue
    } else if has_dep("solid-js") {
        Framework::Solid
    } else if has_dep("vite") {
        Framework::Vite
    } else if has_dep("react") {
        Framework::React
    } else {
        Framework::Node
    };
    let pm = package_manager(dir);
    let scripts = pkg.get("scripts").and_then(Value::as_object);
    let script = |name: &str| scripts.and_then(|s| s.get(name)).and_then(Value::as_str);
    let run = |name: &str| if pm == "npm" { format!("npm run {name}") } else { format!("{pm} {name}") };

    let mut commands = Vec::new();
    if framework == Framework::Expo {
        commands.push(cmd("expo start", "npx expo start".into(), true));
    } else if script("dev").is_some() {
        commands.push(cmd("dev", run("dev"), true));
    } else if script("start").is_some() {
        commands.push(cmd("start", run("start"), true));
    }
    if script("build").is_some() {
        commands.push(cmd("build", run("build"), false));
    }
    commands.push(cmd("install", format!("{pm} install"), false));

    let dev_script = script("dev").or_else(|| script("start")).unwrap_or("");
    let port = port_from_script(dev_script).or_else(|| port_from_config(dir, framework));
    Some(Detection { framework, package_manager: Some(pm.into()), port, commands })
}

/// Picks the package manager from the lockfile present in the repo.
fn package_manager(dir: &Path) -> &'static str {
    if dir.join("pnpm-lock.yaml").exists() {
        "pnpm"
    } else if dir.join("yarn.lock").exists() {
        "yarn"
    } else if dir.join("bun.lockb").exists() || dir.join("bun.lock").exists() {
        "bun"
    } else {
        "npm"
    }
}

/// Extracts an explicit `--port N` / `-p N` from a package script.
fn port_from_script(script: &str) -> Option<u16> {
    let re = Regex::new(r"(?:--port[= ]|-p )(\d{2,5})").ok()?;
    re.captures(script)?.get(1)?.as_str().parse().ok()
}

/// Reads `port:` from a Vite config, falling back to each framework's default port.
fn port_from_config(dir: &Path, framework: Framework) -> Option<u16> {
    let re = Regex::new(r"port\s*:\s*(\d{2,5})").ok()?;
    let from_vite = ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"]
        .iter()
        .filter_map(|f| fs::read_to_string(dir.join(f)).ok())
        .find_map(|src| re.captures(&src)?.get(1)?.as_str().parse().ok());
    from_vite.or(match framework {
        Framework::Vite | Framework::Svelte | Framework::Vue | Framework::Solid => Some(5173),
        Framework::Next | Framework::React | Framework::Nuxt | Framework::Nest => Some(3000),
        Framework::Astro => Some(4321),
        Framework::Angular => Some(4200),
        Framework::Gatsby => Some(8000),
        Framework::Expo => Some(8081),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("claude-storm-detect-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn detects_vite_with_pnpm_and_config_port() {
        let dir = temp_dir("vite");
        fs::write(dir.join("package.json"), r#"{"scripts":{"dev":"vite","build":"vite build"},"devDependencies":{"vite":"7"}}"#).unwrap();
        fs::write(dir.join("pnpm-lock.yaml"), "").unwrap();
        fs::write(dir.join("vite.config.ts"), "export default { server: { port: 4321 } }").unwrap();
        let d = detect(&dir);
        assert_eq!(d.framework, Framework::Vite);
        assert_eq!(d.package_manager.as_deref(), Some("pnpm"));
        assert_eq!(d.port, Some(4321));
        let labels: Vec<_> = d.commands.iter().map(|c| c.command.as_str()).collect();
        assert_eq!(labels, ["pnpm dev", "pnpm build", "pnpm install"]);
    }

    #[test]
    fn detects_laravel() {
        let dir = temp_dir("laravel");
        fs::write(dir.join("composer.json"), r#"{"require":{"laravel/framework":"^11"}}"#).unwrap();
        fs::write(dir.join("artisan"), "").unwrap();
        fs::write(dir.join(".env"), "APP_URL=http://localhost:8010\n").unwrap();
        let d = detect(&dir);
        assert_eq!(d.framework, Framework::Laravel);
        assert_eq!(d.commands[0].command, "php artisan serve --port=8010");
    }

    #[test]
    fn detects_expo_before_react() {
        let dir = temp_dir("expo");
        fs::write(dir.join("package.json"), r#"{"dependencies":{"expo":"51","react":"18"}}"#).unwrap();
        let d = detect(&dir);
        assert_eq!(d.framework, Framework::Expo);
        assert_eq!(d.commands[0].command, "npx expo start");
    }

    #[test]
    fn detects_godot() {
        let dir = temp_dir("godot");
        fs::write(dir.join("project.godot"), "config_version=5\n").unwrap();
        let d = detect(&dir);
        assert_eq!(d.framework, Framework::Godot);
        assert_eq!(d.commands[0].command, "godot --path .");

        let nested = temp_dir("godot-nested");
        fs::create_dir_all(nested.join("godot")).unwrap();
        fs::write(nested.join("godot/project.godot"), "config_version=5\n").unwrap();
        let d = detect(&nested);
        assert_eq!(d.framework, Framework::Godot);
        assert_eq!(d.commands[1].command, "godot --editor --path godot");
    }

    #[test]
    fn detects_rust_crate_and_workspace() {
        let dir = temp_dir("rust");
        fs::write(dir.join("Cargo.toml"), "[package]\nname = \"x\"\n").unwrap();
        let d = detect(&dir);
        assert_eq!(d.framework, Framework::Rust);
        assert_eq!(d.commands[0].command, "cargo run");

        fs::write(dir.join("Cargo.toml"), "[workspace]\nmembers = [\"a\"]\n").unwrap();
        assert_eq!(detect(&dir).commands[0].command, "cargo build");
    }

    #[test]
    fn detects_django_before_node_assets() {
        let dir = temp_dir("django");
        fs::write(dir.join("manage.py"), "import django\n").unwrap();
        fs::write(dir.join("package.json"), r#"{"devDependencies":{"vite":"7"}}"#).unwrap();
        fs::write(dir.join("uv.lock"), "").unwrap();
        let d = detect(&dir);
        assert_eq!(d.framework, Framework::Django);
        assert_eq!(d.commands[0].command, "uv run python manage.py runserver 8000");
        assert_eq!(d.commands.last().unwrap().command, "uv sync");
    }

    #[test]
    fn detects_fastapi_from_requirements() {
        let dir = temp_dir("fastapi");
        fs::write(dir.join("requirements.txt"), "fastapi[standard]==0.115\nuvicorn\n").unwrap();
        let d = detect(&dir);
        assert_eq!(d.framework, Framework::Fastapi);
        assert_eq!(d.port, Some(8000));
    }

    #[test]
    fn detects_nuxt_and_angular_ports() {
        let dir = temp_dir("nuxt");
        fs::write(dir.join("package.json"), r#"{"scripts":{"dev":"nuxt dev"},"dependencies":{"nuxt":"3","vue":"3"}}"#).unwrap();
        let d = detect(&dir);
        assert_eq!(d.framework, Framework::Nuxt);
        assert_eq!(d.port, Some(3000));

        fs::write(dir.join("package.json"), r#"{"scripts":{"start":"ng serve"},"dependencies":{"@angular/core":"18"}}"#).unwrap();
        let d = detect(&dir);
        assert_eq!(d.framework, Framework::Angular);
        assert_eq!(d.port, Some(4200));
    }

    #[test]
    fn detects_spring_with_gradle_wrapper() {
        let dir = temp_dir("spring");
        fs::write(dir.join("build.gradle.kts"), r#"plugins { id("org.springframework.boot") version "3.3.0" }
dependencies { implementation("org.springframework.boot:spring-boot-starter-web") }"#).unwrap();
        fs::write(dir.join("gradlew"), "").unwrap();
        let d = detect(&dir);
        assert_eq!(d.framework, Framework::Spring);
        assert_eq!(d.commands[0].command, "./gradlew bootRun");
    }

    #[test]
    fn unknown_folder_is_generic() {
        let d = detect(&temp_dir("generic"));
        assert_eq!(d.framework, Framework::Generic);
        assert!(d.commands.is_empty());
    }
}
