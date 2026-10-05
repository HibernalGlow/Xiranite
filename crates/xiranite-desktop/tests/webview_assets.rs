//! The two artifacts a Tauri window cannot work without, asserted from the shell that owns them.
//!
//! These moved out of the host crate's headless proof with the channel: `tauri.conf.json` and the
//! self-check page are properties of *this* embedding, not of the loopback backend. A headless host
//! has neither, and a test that reads them from a crate which ships no window would be evidence about
//! a file that crate does not control.

use std::path::Path;

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
    assert!(config["build"].get("beforeDevCommand").is_none(), "the self-check page needs no build tool");
    assert!(config["app"]["windows"].is_array(), "one window is declared");
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
