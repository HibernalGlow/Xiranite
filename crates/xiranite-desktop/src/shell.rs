//! Native dialogs and shell actions: the pick/open/reveal half of the retired Wails bridge.
//!
//! ## Why this lives in the shell and not in the loopback backend
//!
//! `src/components/modules/hostApi.ts` advertises `localFiles.pickFiles / pickDirectory / pickDirectories
//! / openPath / revealPath` to every node, and the retired Wails adapter answered those with **native**
//! dialogs (`hostApi.ts:192-197` records exactly that). The HTTP backend deliberately has no
//! `/local-files/*` route — `crates/xiranite-api/src/lib.rs:143-159` is the whole table — because a
//! file-picker is a property of the window that asked for it: it is window-modal, it needs the parent
//! window on Windows, and its result is a path the *user just authorised*, which is the same
//! `NodeRequirements` reasoning ADR-0073 moved the permission model to. So the shell answers it.
//!
//! ## Dependency choice, recorded
//!
//! `tauri-plugin-dialog` 3.0.0-alpha.2 and `tauri-plugin-opener` 3.0.0-alpha.2 exist for this Tauri
//! line, but the first pulls `tauri-plugin-fs` (a whole scope/permission system this app does not use —
//! filesystem access goes through operations) and the second pulls `windows 0.61`, `zbus 5.9` and the
//! objc2 app-kit bindings. Both would also put their *own* command names and ACL entries in front of the
//! WebView, while every other shell capability here is one `xiranite_*` command. So this module depends
//! on the engines those plugins wrap — `rfd` for the dialogs, `open` for the default-application launch —
//! and keeps one command vocabulary. Revisit if the plugins drop their extra graph.
//!
//! The measured cost of that choice, from `cargo metadata` on this graph: `rfd 0.17.2` + `open 5.4.4`
//! reach a 69-package closure, of which **13** are net-new to the workspace — `wayland-backend/client/
//! protocols/scanner/sys`, `dlib`, `libloading`, `downcast-rs`, `scoped-tls`, `pollster`, `quick-xml`,
//! `is-docker`, `is-wsl` — and every one of them is Linux-gated. Recomputing the closure under macOS
//! targets alone gives **0** net-new packages: tauri already carries the objc2/dispatch side.
//!
//! ## Errors are values
//!
//! Every command answers `Result<_, String>`: the WebView's `pickFiles` is awaited by node UI and the
//! existing fallback path in `useLocalFileDrop` distinguishes "user cancelled" (empty list) from "host
//! cannot do this" (rejection). Cancelling is **not** an error — the Go bridge returned an empty list, and
//! a rejection there would light up an error toast for someone dismissing a dialog.

use serde::Deserialize;
use serde::Serialize;
use tauri::AppHandle;

/// What the WebView asked for, mirroring `NodeFilePickerOptions` and the `kind` the HTTP-era client sent.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickOptions {
    /// `"files"` or `"directory"`; anything else is refused rather than guessed at.
    pub kind: String,
    #[serde(default)]
    pub multiple: Option<bool>,
    #[serde(default)]
    pub title: Option<String>,
    /// Extension filters without the dot (`["png", "jpg"]`), as the node capability declares them.
    #[serde(default)]
    pub extensions: Option<Vec<String>>,
    /// Suggested starting directory, when the caller knows one.
    #[serde(default)]
    pub starting_path: Option<String>,
}

/// One picked path plus whether it is a directory, so a caller can validate without a second round trip.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedPath {
    pub path: String,
    pub is_directory: bool,
}

/// The two kinds the node capability vocabulary knows. Anything else is refused rather than guessed at,
/// because silently treating `"drives"` as a folder picker would hand a node a path it never asked for.
fn validate_kind(kind: &str) -> Result<(), String> {
    match kind {
        "files" | "directory" => Ok(()),
        other => Err(format!("unsupported pick kind {other:?}.")),
    }
}

/// A blank path is a caller bug, not a shell failure, and it must not reach `open(1)` as an empty argument.
fn require_path(path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("a path is required.".to_owned());
    }
    Ok(())
}

/// `localFiles.pickFiles/pickDirectory/pickDirectories`: a native open dialog, or an empty list on cancel.
#[tauri::command]
pub async fn xiranite_dialog_pick(options: PickOptions) -> Result<Vec<PickedPath>, String> {
    validate_kind(&options.kind)?;
    let multiple = options.multiple.unwrap_or(true);
    let mut dialog = rfd::AsyncFileDialog::new();
    if let Some(title) = options.title.as_deref().filter(|title| !title.trim().is_empty()) {
        dialog = dialog.set_title(title);
    }
    if let Some(start) = options.starting_path.as_deref().filter(|start| !start.trim().is_empty()) {
        dialog = dialog.set_directory(start);
    }
    if options.kind == "files" {
        for extension in options.extensions.unwrap_or_default() {
            let trimmed = extension.trim().trim_start_matches('.');
            if !trimmed.is_empty() {
                dialog = dialog.add_filter(trimmed, &[trimmed]);
            }
        }
    }

    let picked = match options.kind.as_str() {
        "files" => {
            if multiple {
                dialog.pick_files().await.into_iter().flat_map(|files| files.into_iter().map(|file| file.path().to_string_lossy().into_owned()).collect::<Vec<_>>()).collect()
            } else {
                dialog.pick_file().await.map(|file| vec![file.path().to_string_lossy().into_owned()]).unwrap_or_default()
            }
        }
        "directory" => {
            if multiple {
                dialog.pick_folders().await.into_iter().flat_map(|folders| folders.into_iter().map(|folder| folder.path().to_string_lossy().into_owned()).collect::<Vec<_>>()).collect()
            } else {
                dialog.pick_folder().await.map(|folder| vec![folder.path().to_string_lossy().into_owned()]).unwrap_or_default()
            }
        }
        _ => return Err("unreachable: the kind was validated above".to_owned()),
    };

    Ok(picked
        .into_iter()
        .map(|path| PickedPath { is_directory: options.kind == "directory", path })
        .collect())
}

/// `localFiles.openPath`: hand the path to the operating system's default application.
#[tauri::command]
pub fn xiranite_shell_open_path(_app: AppHandle, path: String) -> Result<(), String> {
    require_path(&path)?;
    // `that_detached` so a spawned helper does not tie the shell's lifetime to the viewer's.
    open::that_detached(&path).map_err(|error| format!("{path} could not be opened: {error}"))
}

/// `localFiles.revealPath`: show the path inside its parent directory in the platform's file manager.
#[tauri::command]
pub fn xiranite_shell_reveal_path(_app: AppHandle, path: String) -> Result<(), String> {
    require_path(&path)?;
    let target = std::path::Path::new(&path);
    let exists = target.try_exists().map_err(|error| format!("{path} is unreadable: {error}"))?;
    if !exists {
        return Err(format!("{path} does not exist."));
    }

    #[cfg(target_os = "macos")]
    let command = {
        let mut command = std::process::Command::new("open");
        command.arg("-R").arg(target);
        command
    };
    #[cfg(windows)]
    let command = {
        let mut command = std::process::Command::new("explorer");
        command.arg(format!("/select,{}", target.display()));
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let command = {
        // No portable "select this item" exists on Linux, so the honest behaviour is to open the
        // directory that contains it — which is also what the retired host's browser fallback did.
        let mut command = std::process::Command::new("xdg-open");
        command.arg(target.parent().unwrap_or(target));
        command
    };

    spawn_undetached(command, &path)
}

fn spawn_undetached(mut command: std::process::Command, path: &str) -> Result<(), String> {
    use std::process::Stdio;
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    match command.spawn() {
        Ok(_) => Ok(()),
        Err(error) => Err(format!("{path} could not be revealed: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The WebView sends camelCase; a snake_case field would deserialize as `None` and silently drop the
    /// caller's filters.
    #[test]
    fn pick_options_deserialize_the_shape_the_webview_sends() {
        let options: PickOptions = serde_json::from_str(
            r#"{ "kind": "files", "multiple": false, "title": "选图", "extensions": [".png", "jpg"], "startingPath": "/tmp" }"#,
        )
        .expect("the camelCase wire shape");
        assert_eq!(options.kind, "files");
        assert_eq!(options.multiple, Some(false));
        assert_eq!(options.starting_path.as_deref(), Some("/tmp"));
        assert_eq!(options.extensions.as_deref(), Some([".png".to_owned(), "jpg".to_owned()].as_slice()));
    }

    #[test]
    fn an_absent_optional_block_still_deserializes() {
        let options: PickOptions = serde_json::from_str(r#"{ "kind": "directory" }"#).unwrap();
        assert_eq!(options.multiple, None, "absent means the default, which is multi-select");
        assert!(options.extensions.is_none());
    }

    /// A cancelled dialog is an empty list, and the kind check is what keeps `pickFiles` from silently
    /// becoming a folder picker when a caller typos the kind.
    #[test]
    fn only_the_two_known_kinds_are_accepted() {
        for kind in ["files", "directory"] {
            assert!(validate_kind(kind).is_ok(), "{kind} must be accepted");
        }
        assert!(validate_kind("drives").is_err(), "an unknown kind must be refused, not guessed");
        assert!(validate_kind("Files").is_err(), "the kind is case-sensitive because the wire value is ours");
    }

    /// The same guard the two shell commands call, so a blank path cannot reach `open(1)` as an argument.
    #[test]
    fn blank_paths_are_refused_before_touching_the_shell() {
        assert!(require_path("").is_err());
        assert!(require_path("   ").is_err());
        assert!(require_path("/tmp").is_ok());
    }
}
