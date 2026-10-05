//! The node's one path field, served by a WASI preopen instead of a capability call.
//!
//! ADR-0071 retired `xiranite.fs.*`: the host turns WASI on, maps the manifest's `allowed_paths`
//! into preopens, and the guest uses `std::fs`. For SoundW that is exactly one `stat`, because
//! `platform.ts:7-9` only ever asked whether the caller's CLI path is there:
//!
//! ```text
//! if (path) { try { await stat(path); return { found: true, path } } catch { return { found: false, path: "" } } }
//! ```
//!
//! Two consequences the rest of the crate relies on:
//!
//! - **Containment is the engine's, not this module's.** A path outside a granted preopen answers
//!   `NotFound` (ADR-0071 §2 measured errno 44 for `/etc/hosts`, and 63 for a `..` escape), so a
//!   plain existence probe is already an authorized probe. That is why nothing here inspects
//!   separators, drive letters or `..`: ADR-0071 §5 measured that a `wasm32-wasip1` guest reads
//!   `C:\windows\system32` as *one* path component, so host-shaped path analysis in the guest would
//!   be wrong on the Windows release gate.
//! - **Read-only is enough.** The node never writes to the CLI, so `manifest.toml` grants the root
//!   with the `ro:` prefix; a write attempt would answer `Unsupported`/errno 58 rather than mutate
//!   anything.
//!
//! When no override was given, the answer is not the guest's to give: the PATH search
//! `platform.ts:11-15` did with `which`/`where.exe` belongs to the host's command registration, so
//! this module reports `NotProbed` and `crate::soundw_core` runs against
//! [`host_functions::SOUNDW_REGISTERED_COMMAND`].

use crate::soundw_runtime::SoundwBinaryResolution;

/// The guest-visible alias of the read-only preopen `manifest.toml` grants for the CLI directory.
pub const PREOPEN_ALIAS: &str = "/soundswitch";
/// The default spelling the faces show for `soundSwitchPath` (`interaction.ts:22`,
/// `node-definitions/soundw.json:231-235`), which is the Windows binary name.
pub const DEFAULT_CLI_FILE_NAME: &str = crate::host_functions::SOUNDW_CLI_BINARY_WINDOWS;

/// `platform.ts:8-9`: does the caller's path exist where the guest is allowed to look?
///
/// `fs::metadata` is used rather than `fs::symlink_metadata` because Node's `stat` follows symlinks,
/// and because SoundSwitch's CLI is routinely reached through one.
#[must_use]
pub fn preopen_path_exists(path: &str) -> bool {
    std::fs::metadata(path).is_ok()
}

/// The pre-flight verdict for a `soundSwitchPath` value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SoundwCliProbe {
    /// No override was given, so the host's registered command decides.
    NotProbed,
    /// The override exists (or is not reachable from a granted preopen, which is the same answer
    /// `platform.ts:9` gave for a missing file).
    Located(SoundwBinaryResolution),
    /// The override names something that is not there.
    Absent,
}

/// `platform.ts:7-9` as a pure function of the override text.
#[must_use]
pub fn probe_cli_override(path_override: Option<&str>) -> SoundwCliProbe {
    let Some(path) = path_override.filter(|value| !value.is_empty()) else {
        return SoundwCliProbe::NotProbed;
    };
    if preopen_path_exists(path) {
        SoundwCliProbe::Located(SoundwBinaryResolution::found(path))
    } else {
        SoundwCliProbe::Absent
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A scratch directory under the system temp root, removed at the end of the probe tests. It
    /// stands in for the preopen the host would grant, and nothing here reads a real install.
    struct Scratch {
        root: std::path::PathBuf,
    }

    impl Scratch {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!("xiranite-soundw-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(&root).expect("scratch directory");
            Self { root }
        }

        fn with_file(&self, file_name: &str) -> std::path::PathBuf {
            let path = self.root.join(file_name);
            std::fs::write(&path, b"placeholder").expect("scratch file");
            path
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn an_existing_override_path_resolves_to_itself() {
        let scratch = Scratch::new("probe");
        let file = scratch.with_file(DEFAULT_CLI_FILE_NAME);
        let text = file.to_str().expect("utf-8 temp path");
        assert!(preopen_path_exists(text));
        assert_eq!(
            probe_cli_override(Some(text)),
            SoundwCliProbe::Located(SoundwBinaryResolution::found(text))
        );
    }

    #[test]
    fn a_missing_override_path_is_absent_and_not_probed_is_only_for_absent_input() {
        let scratch = Scratch::new("absent");
        let text = scratch.root.join("nope.exe").to_str().expect("utf-8 temp path").to_owned();
        assert!(!preopen_path_exists(&text));
        assert_eq!(probe_cli_override(Some(&text)), SoundwCliProbe::Absent);
        // Negative controls: the three ways a request carries "no override" are all NotProbed, and
        // a directory counts as present the way Node's `stat` would.
        assert_eq!(probe_cli_override(None), SoundwCliProbe::NotProbed);
        assert_eq!(probe_cli_override(Some("")), SoundwCliProbe::NotProbed);
        assert_eq!(
            probe_cli_override(Some(scratch.root.to_str().expect("utf-8 temp path"))),
            SoundwCliProbe::Located(SoundwBinaryResolution::found(
                scratch.root.to_str().expect("utf-8 temp path")
            ))
        );
    }
}
