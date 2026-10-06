//! The two artifacts a Tauri window cannot work without, asserted from the shell that owns them.
//!
//! These moved out of the host crate's headless proof with the channel: `tauri.conf.json` and the
//! self-check page are properties of *this* embedding, not of the loopback backend. A headless host
//! has neither, and a test that reads them from a crate which ships no window would be evidence about
//! a file that crate does not control.

use std::path::{Path, PathBuf};

/// Collapse `.` and `..` in a path without touching the filesystem, so a test can compare configured
/// relative paths even when the target is a build product that has not been produced yet.
fn resolve_lexically(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// The repository root, two levels above `<root>/crates/xiranite-desktop`.
fn repo_root_of(manifest_dir: &Path) -> &Path {
    manifest_dir
        .parent()
        .and_then(Path::parent)
        .expect("the desktop crate sits under the repository root")
}

/// The `tauri.conf.json` the WebView depends on is one of the two things `src/backend/tauriChannel.ts`
/// cannot work without: the global Tauri object (there is no `@tauri-apps/api` in the bundle).
#[test]
fn the_desktop_config_keeps_the_webview_contract_and_stays_platform_neutral() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{} is unreadable: {error}", path.display()));
    let config: serde_json::Value = serde_json::from_str(&text).expect("tauri.conf.json is valid JSON");

    assert_eq!(config["app"]["withGlobalTauri"], serde_json::json!(true), "window.__TAURI__ must exist for the structural read");
    assert_eq!(config["bundle"]["active"], serde_json::json!(false), "bundling is not part of this seam yet");
    assert_eq!(
        config["bundle"]["icon"].as_array().map(Vec::len),
        Some(0),
        "no icon means no platform-specific asset requirement"
    );
    assert!(config["app"]["windows"].is_array(), "one window is declared");

    // Packaging reads `build.frontendDist`; development does not. `tauri-codegen`'s `context.rs` takes the
    // `dev && dev_url.is_some()` branch and embeds *no* assets, and `dev` comes from `DEP_TAURI_DEV`, which
    // the `tauri` crate clears when the `custom-protocol` feature is on — which is exactly what `tauri build`
    // passes and plain `cargo build` does not. Measured 2026-10-05: `cargo clean -p xiranite-desktop` plus
    // `cargo build` with no `dist/` at all still succeeds (27s), while `tauri build --debug` embeds the dist
    // chunks. So `bun run dev:desktop` can never see a packaging-payload problem, and this key is the only
    // thing deciding what a shipped app shows: it must name the product bundle, not this crate's self-check
    // page. An app packaged while it said `"frontend"` booted the diagnostic page — found by launching one,
    // not by any build step.
    assert_eq!(
        config["build"]["frontendDist"],
        serde_json::json!("../../dist"),
        "a packaged app must embed the product React bundle, not crates/xiranite-desktop/frontend/"
    );
    assert!(
        config["build"]["beforeBuildCommand"].is_string(),
        "`tauri build` must produce the dist itself; a missing frontendDist panics tauri-codegen in release"
    );
    // `frontendDist` is resolved against the directory holding this file, so the value is crate-relative:
    // `../dist` points at `crates/dist` and packaging dies with "Unable to find your web assets" naming
    // that path. Measured 2026-10-05 by building with a `--config` that did not override it.
    //
    // Lexical, not `canonicalize()`: `dist/` is a build product that a CI job running `cargo test` before
    // any frontend build has no reason to have produced, so requiring it to exist would turn build order
    // into a red suite.
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let frontend_dist = config["build"]["frontendDist"]
        .as_str()
        .expect("frontendDist is a string");
    assert_eq!(
        resolve_lexically(&manifest_dir.join(frontend_dist)),
        resolve_lexically(&repo_root_of(manifest_dir).join("dist")),
        "the packaged payload must be the repository-root Vite output"
    );
    assert!(
        config["build"].get("beforeDevCommand").is_none(),
        "dev loads `devUrl`, so it needs no build tool — and must not gain one, or the dev path would start \
         depending on a frontend build it does not read"
    );
}

/// The self-check page is no longer the packaged payload, so it has to stay reachable deliberately:
/// `tauri.conf.selfcheck.json` re-points `frontendDist` at this crate's `frontend/` for a diagnostic build.
/// Without this, the honest-page test below would guard a file nothing can load.
#[test]
fn the_selfcheck_flavor_still_points_at_the_plain_html_page() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let path = manifest_dir.join("tauri.conf.selfcheck.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{} is unreadable: {error}", path.display()));
    let config: serde_json::Value = serde_json::from_str(&text).expect("the self-check flavor config is valid JSON");

    assert_eq!(
        config["build"]["frontendDist"],
        serde_json::json!("frontend"),
        "the self-check flavor must embed this crate's frontend/ directory"
    );
    assert_eq!(
        config["identifier"],
        serde_json::json!("app.xiranite.selfcheck"),
        "it must not collide with the product identifier, or a diagnostic build would overwrite the product app"
    );

    let page = manifest_dir.join("frontend").join("index.html");
    assert!(page.is_file(), "the self-check flavor embeds a page that must exist");
}

/// The self-check page is served from the crate's own `frontend/` directory through Tauri's asset
/// mechanism, and it must say what it is rather than look like the product GUI.
#[test]
fn the_selfcheck_page_is_plain_html_and_names_itself_honestly() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("frontend").join("index.html");
    let page = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{} is unreadable: {error}", path.display()));

    assert!(page.contains("Rust 后端 + 节点运行自检页"), "the page title must state what it is");
    assert!(page.contains("这不是产品 GUI"), "the page must not pose as the product surface");
    assert!(page.contains("xiranite_bootstrap"), "the page calls the bootstrap command");
    assert!(page.contains("/nodes/dissolvef/operations"), "the page drives a dissolvef operation");
    assert!(page.contains("/stream?token="), "the page uses the query-token stream channel");
    // The real property is "no bundler and no npm dependency", which a bare substring search for
    // `@tauri-apps/api` would not express: the page explains *why* it does not import that package,
    // so the name appears in prose while the module graph stays empty.
    assert!(!page.contains("<script src="), "no external script: inline only");
    assert!(!page.contains("type=\"module\""), "no ES module graph to build");
    assert!(!page.contains("import \"@tauri-apps") && !page.contains("from \"@tauri-apps"), "the Tauri global is read structurally");
}
