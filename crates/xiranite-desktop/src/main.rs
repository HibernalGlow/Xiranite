//! Tauri assembly for the Xiranite desktop host.
//!
//! Deliberately thin: stage the node runtime from the environment, start the loopback backend,
//! publish its channel as managed state, register `xiranite_bootstrap`, open the one window. The
//! channel itself — bind, token, instance id, router, shutdown — lives in
//! `xiranite_loopback_host::start_backend` and the staging in `xiranite_loopback_host::launcher`, so
//! the headless `xiranite-dev-host` binary and `crates/xiranite-loopback-host/tests/headless_host.rs`
//! drive the identical code paths (ADR-0065) with no window server involved.
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

use tauri::Manager;
use xiranite_desktop::bootstrap::BootstrapState;
use xiranite_desktop::bootstrap::xiranite_bootstrap;
use xiranite_desktop::tray::xiranite_tray_capabilities;
use xiranite_desktop::tray::xiranite_tray_set_main_enabled;
use xiranite_desktop::tray::xiranite_tray_sync;
use xiranite_desktop::windows::forward_component_frame_event;
use xiranite_desktop::windows::forget_component_window;
use xiranite_desktop::windows::xiranite_open_component_window;
use xiranite_desktop::windows::xiranite_window_capabilities;
use xiranite_desktop::windows::xiranite_window_close;
use xiranite_desktop::windows::xiranite_window_control;
use xiranite_desktop::windows::xiranite_window_focus;
use xiranite_desktop::windows::xiranite_window_get_frame;
use xiranite_desktop::windows::xiranite_window_open_devtools;
use xiranite_desktop::windows::xiranite_window_set_frame;
use xiranite_desktop::windows::xiranite_window_start_dragging;
use xiranite_loopback_host::BackendStart;
use xiranite_loopback_host::HostChannel;
use xiranite_loopback_host::remove_channel_file;
use xiranite_loopback_host::stage_from_environment;
use xiranite_loopback_host::staging_summary;
use xiranite_loopback_host::start_backend;
use xiranite_loopback_host::write_channel_file;

// `#[tauri::command]` on a `pub` fn emits two `#[macro_export]` helper macros named after the command
// (tauri-macros-2.7.1/src/command/wrapper.rs:162-168), and `generate_handler!` rewrites the last path
// segment of each command into `__tauri_command_name_<command>` (handler.rs:161-171). The command
// lives in the library so the payload projection stays unit-tested, so the binary has to pull those
// generated helpers in by name; they are referenced only inside the macro expansion, which the
// unused-import lint cannot see, hence the allow.
#[allow(unused_imports)]
use xiranite_desktop::{
    __cmd__xiranite_bootstrap, __cmd__xiranite_open_component_window, __cmd__xiranite_window_capabilities,
    __cmd__xiranite_window_close, __cmd__xiranite_window_control, __cmd__xiranite_window_focus,
    __cmd__xiranite_window_get_frame, __cmd__xiranite_window_open_devtools, __cmd__xiranite_window_set_frame, __cmd__xiranite_window_start_dragging,
    __cmd__xiranite_tray_capabilities, __cmd__xiranite_tray_set_main_enabled, __cmd__xiranite_tray_sync,
    __tauri_command_name_xiranite_bootstrap, __tauri_command_name_xiranite_open_component_window,
    __tauri_command_name_xiranite_tray_capabilities, __tauri_command_name_xiranite_tray_set_main_enabled,
    __tauri_command_name_xiranite_tray_sync, __tauri_command_name_xiranite_window_capabilities,
    __tauri_command_name_xiranite_window_close, __tauri_command_name_xiranite_window_control,
    __tauri_command_name_xiranite_window_focus, __tauri_command_name_xiranite_window_get_frame,
    __tauri_command_name_xiranite_window_open_devtools, __tauri_command_name_xiranite_window_set_frame,
    __tauri_command_name_xiranite_window_start_dragging,
};

fn main() {
    // Plugin staging is the same code path a headless host takes (`launcher::stage_from_environment`),
    // so the only thing the window adds is the event loop; see the module docs of that file for the
    // three environment variables it reads.
    let staged = match stage_from_environment() {
        Ok(staged) => staged,
        Err(error) => {
            // A host with nothing to run would open a window whose every node card turns red, so the
            // build command in the message is the point of exiting here.
            eprintln!("xiranite-desktop: {error}");
            std::process::exit(78);
        }
    };
    eprintln!("xiranite-desktop: {}", staging_summary(&staged));

    let backend = match start_backend(BackendStart::new(staged.launcher)) {
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
    let channel_file = channel_file_path();
    if let Some(path) = &channel_file
        && let Err(error) = write_channel_file(&channel, path)
    {
        // The window works without the file; a caller that asked for it and does not get it would
        // otherwise wait on a path that never appears.
        eprintln!("xiranite-desktop: the channel file could not be published: {error}");
    }

    // Tauri 3 has no default runtime: `tauri` 3.0.0-alpha.4 depends on `tauri-runtime` only, and the
    // wry bindings are a separate crate the binary picks (`no runtime was configured` is what
    // `Builder::default().run()` answers without it). Declaring the runtime here rather than relying on
    // a feature keeps the choice visible: this host shows a WebView, so it is a wry host.
    let built = tauri::Builder::default()
        .runtime(tauri_runtime_wry::Wry::default())
        .manage(BootstrapState::new(channel))
        // Which component windows are open, and with which module/workspace ids: the frame events the
        // workspace store remembers sizes from are addressed out of this, not re-derived from a label.
        .manage(xiranite_desktop::windows::ComponentWindows::default())
        .manage(xiranite_desktop::tray::TrayState::default())
        .on_menu_event(|app, event| xiranite_desktop::tray::handle_menu_event(app, event.id().as_ref()))
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Resized(_) => forward_component_frame_event(window),
            tauri::WindowEvent::Destroyed => forget_component_window(window),
            // The Go host's `WindowClosing` hook: while the tray is enabled, closing the main window hides
            // it and the process keeps serving. `should_keep_running` already turns false on tray-quit,
            // so this is the only thing standing between "close to tray" and an unquittable process.
            tauri::WindowEvent::CloseRequested { api, .. }
                if window.label() == "main" && window.state::<xiranite_desktop::tray::TrayState>().should_keep_running() =>
            {
                api.prevent_close();
                window.hide().ok();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            xiranite_bootstrap,
            xiranite_window_capabilities,
            xiranite_open_component_window,
            xiranite_window_control,
            xiranite_window_focus,
            xiranite_window_close,
            xiranite_window_open_devtools,
            xiranite_window_get_frame,
            xiranite_window_set_frame,
            xiranite_window_start_dragging,
            xiranite_tray_capabilities,
            xiranite_tray_set_main_enabled,
            xiranite_tray_sync
        ])
        .run(tauri::generate_context!());

    // `backend` is dropped here, which requests the graceful shutdown; `shutdown()` also waits for
    // the host thread so a `cargo run` session does not outlive its listener.
    if let Err(error) = backend.shutdown() {
        eprintln!("xiranite-desktop: the loopback backend did not stop cleanly: {error}");
    }
    if let Some(path) = &channel_file {
        remove_channel_file(path);
    }
    if let Err(error) = built {
        eprintln!("xiranite-desktop: the Tauri host exited with an error: {error}");
        std::process::exit(1);
    }
}

/// Where to publish the channel document, from `XIRANITE_CHANNEL_FILE`. Debug builds only: the file
/// carries the bearer token, so a release host must not write it to disk no matter what the environment
/// says (`xiranite-dev-host`, which prints it to stdout, is debug-only for the same reason).
#[must_use]
fn channel_file_path() -> Option<std::path::PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    std::env::var_os("XIRANITE_CHANNEL_FILE").map(std::path::PathBuf::from)
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
