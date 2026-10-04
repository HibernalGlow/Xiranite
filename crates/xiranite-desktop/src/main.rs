//! Tauri assembly for the Xiranite desktop host.
//!
//! Deliberately thin: start the loopback backend, publish its channel as managed state, register
//! `xiranite_bootstrap`, open the one window. The channel itself — bind, token, instance id, router,
//! shutdown — lives in `xiranite_desktop::start_backend` so a headless integration test drives the
//! identical code path (ADR-0065), and the launcher is injected there rather than decided here.
//!
//! The window loads `frontend/index.html`, the Rust-backend + node-run self-check page. That page is
//! a diagnostic, not the product GUI: the React bundle in `src/` is the product surface and reaches
//! the same channel through `src/backend/tauriChannel.ts`.
//!
//! `icons/icon.png` is a placeholder, not branding: on every non-Windows target `generate_context!`
//! resolves the default window icon by looking for a PNG in `bundle.icon` and falling back to
//! `icons/icon.png` (`tauri-codegen-2.7.1/src/context.rs:211-226`), so the host would not compile
//! without one while `bundle.active` is still `false`.

// Release Windows builds must not show a console window; this is the one genuine platform boundary
// in the host, and it is an attribute rather than a code branch.
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "hidden")]

use std::path::PathBuf;
use std::sync::Arc;

use xiranite_api::OperationLauncher;
use xiranite_core::SystemClock;
use xiranite_desktop::BackendStart;
use xiranite_desktop::BootstrapState;
use xiranite_desktop::HostChannel;
use xiranite_desktop::bootstrap::xiranite_bootstrap;
use xiranite_desktop::start_backend;
use xiranite_node_runtime::{NodeRegistry, NodeRuntime};

// `#[tauri::command]` on a `pub` fn emits two `#[macro_export]` helper macros named after the command
// (tauri-macros-2.7.1/src/command/wrapper.rs:162-168), and `generate_handler!` rewrites the last path
// segment of each command into `__tauri_command_name_<command>` (handler.rs:161-171). The command
// lives in the library so the payload projection stays unit-tested, so the binary has to pull those
// generated helpers in by name; they are referenced only inside the macro expansion, which the
// unused-import lint cannot see, hence the allow.
#[allow(unused_imports)]
use xiranite_desktop::{__cmd__xiranite_bootstrap, __tauri_command_name_xiranite_bootstrap};

/// The launcher seam. Everything that starts a node belongs to `xiranite-node-runtime` (ADR-0069);
/// the host only says which `Arc<dyn OperationLauncher>` the API context is built with.
///
/// Configuration is environment-only, because the desktop host has no settings UI for it yet:
///
/// - `XIRANITE_PLUGIN_DIR` — the staged plugin root (`<id>/manifest.json` + `<id>.wasm`), default
///   `artifacts/plugins` relative to the working directory, which is what `bun run build:node-wasm`
///   writes.
/// - `XIRANITE_ALLOWED_DIRS` — the roots an operation may reach through `xiranite.fs.*`, separated by
///   `:` or `;` (both spellings are accepted so one command line works on Windows and macOS).
/// - `XIRANITE_DATA_DIR` — where per-node artifacts such as undo histories live.
///
/// A missing or unreadable plugin directory is fatal with the build command in the message: a window
/// that reports "no plugin runtime is attached" after the artifacts exist would send the reader to the
/// wrong crate.
fn launcher() -> Arc<dyn OperationLauncher> {
    let plugin_dir = std::env::var_os("XIRANITE_PLUGIN_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("artifacts").join("plugins"));
    let registry = match NodeRegistry::load(&plugin_dir) {
        Ok(registry) => Arc::new(registry),
        Err(error) => {
            eprintln!(
                "xiranite-desktop: no usable plugins staged under {}: {error}\n\
                 build one first: bun run build:node-wasm dissolvef",
                plugin_dir.display()
            );
            std::process::exit(78);
        }
    };
    let ids: Vec<String> = registry.ids().map(str::to_owned).collect();
    if ids.is_empty() {
        eprintln!(
            "xiranite-desktop: {} exists but stages no node; build one with `bun run build:node-wasm <id>`",
            plugin_dir.display()
        );
        std::process::exit(78);
    }

    let grants = std::env::var_os("XIRANITE_ALLOWED_DIRS")
        .map(|value| {
            value
                .to_string_lossy()
                .split([':', ';'])
                .filter(|path| !path.trim().is_empty())
                .map(PathBuf::from)
                .collect()
        })
        .unwrap_or_else(Vec::new);
    let data_dir = std::env::var_os("XIRANITE_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| plugin_dir.parent().map_or_else(|| PathBuf::from("host-data"), |root| root.join("host-data")));

    eprintln!(
        "xiranite-desktop: nodes [{}] granting {} root(s)",
        ids.join(", "),
        grants.len()
    );
    Arc::new(NodeRuntime::new(registry, Arc::new(SystemClock), grants, data_dir))
}

fn main() {
    let backend = match start_backend(BackendStart::new(launcher())) {
        Ok(backend) => backend,
        Err(error) => {
            // No channel means the WebView cannot reach a backend at all; exiting beats opening a
            // window that would only ever show a red status banner.
            eprintln!("xiranite-desktop: the loopback backend did not start: {error}");
            std::process::exit(70);
        }
    };
    let channel: HostChannel = backend.channel().clone();
    log_channel_to_stderr(&channel);

    let built = tauri::Builder::default()
        .manage(BootstrapState::new(channel))
        .invoke_handler(tauri::generate_handler![xiranite_bootstrap])
        .run(tauri::generate_context!());

    // `backend` is dropped here, which requests the graceful shutdown; `shutdown()` also waits for
    // the host thread so a `cargo run` session does not outlive its listener.
    if let Err(error) = backend.shutdown() {
        eprintln!("xiranite-desktop: the loopback backend did not stop cleanly: {error}");
    }
    if let Err(error) = built {
        eprintln!("xiranite-desktop: the Tauri host exited with an error: {error}");
        std::process::exit(1);
    }
}

/// Prints the channel without the token: the port and the instance id are what makes a stuck host
/// diagnosable from a terminal, and the token is a credential.
fn log_channel_to_stderr(channel: &HostChannel) {
    eprintln!(
        "xiranite-desktop: backend on {} as instance {} (token withheld, {}/64 chars)",
        channel.base_url(),
        channel.instance_id(),
        channel.token().len()
    );
}
