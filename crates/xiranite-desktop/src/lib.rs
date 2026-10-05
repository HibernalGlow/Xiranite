//! The Xiranite desktop shell: one Tauri window that embeds the loopback host.
//!
//! The backend itself is `crates/xiranite-loopback-host` — bind, token, instance id, router, node
//! staging, graceful shutdown. This crate keeps only what is true *because there is a window*: the
//! `xiranite_bootstrap` command that hands this WebView the channel, the Tauri assembly in `main.rs`,
//! and the self-check page in `frontend/`.
//!
//! The split is what lets a headless host exist at all. `xiranite-desktop`'s build script runs
//! `tauri_build::build()` and reads `build.frontendDist`, and a build script cannot be gated away per
//! binary, so a headless development host that lived in this crate would still compile the whole
//! windowing stack. `xiranite-dev-host` lives in the host crate instead and links no Tauri.
//!
//! ## Nothing here is platform specific
//!
//! The self-check page is served by Tauri's own asset mechanism, and the channel is read back from the
//! socket, so Windows and macOS run identical code. The one genuine platform boundary is in `main.rs`:
//! a release Windows build hides its console window, and that is an attribute, not a branch.

pub mod bootstrap;
pub mod windows;
