//! Tauri assembly for the Xiranite desktop host.
//!
//! Deliberately thin: stage the node runtime from the environment, start the loopback backend,
//! publish its channel as managed state, register `xiranite_bootstrap`, open the one window. The
//! channel itself — bind, token, instance id, router, shutdown — lives in
//! `xiranite_desktop::start_backend` and the staging in `xiranite_desktop::launcher`, so
//! `src/bin/dev_host.rs` and a headless integration test drive the identical code paths (ADR-0065)
//! with no window server involved.
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

use xiranite_desktop::BackendStart;
use xiranite_desktop::BootstrapState;
use xiranite_desktop::HostChannel;
use xiranite_desktop::bootstrap::xiranite_bootstrap;
use xiranite_desktop::stage_from_environment;
use xiranite_desktop::staging_summary;
use xiranite_desktop::start_backend;

// `#[tauri::command]` on a `pub` fn emits two `#[macro_export]` helper macros named after the command
// (tauri-macros-2.7.1/src/command/wrapper.rs:162-168), and `generate_handler!` rewrites the last path
// segment of each command into `__tauri_command_name_<command>` (handler.rs:161-171). The command
// lives in the library so the payload projection stays unit-tested, so the binary has to pull those
// generated helpers in by name; they are referenced only inside the macro expansion, which the
// unused-import lint cannot see, hence the allow.
#[allow(unused_imports)]
use xiranite_desktop::{__cmd__xiranite_bootstrap, __tauri_command_name_xiranite_bootstrap};

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
