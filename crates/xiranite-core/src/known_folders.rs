//! Known user folders (Pictures / Videos / Desktop / Downloads) as a host capability.
//!
//! ## Why the host owns this
//!
//! Several nodes carry a Windows path as a *default value*: a wallpaper library under `E:\`, a
//! screenshot folder under `C:\Users\…\Desktop`. On macOS and Linux those are not merely wrong — they
//! name drives that do not exist, so the first guided run starts with an unusable field. The answer is
//! not a `cfg` branch per node; the OS already has a name for each of these folders, and it is spelled
//! three different ways: the Windows Known Folder API, macOS' Standard Directories, and XDG user-dirs on
//! freedesktop. `dirs` 7.0.0 implements all three, and it is already in this lock (brought in by
//! `tauri`), so adopting it adds no package to the graph.
//!
//! ## The Roaming trap, stated once here because it is the reason not to use this for app data
//!
//! `dirs::data_dir()` and `dirs::config_dir()` answer `{FOLDERID_RoamingAppData}` on Windows
//! (`C:\Users\X\AppData\Roaming`), while this product's data root is `%LOCALAPPDATA%\Xiranite` —
//! `config_paths.rs:99-118` and `packages/platform/src/index.ts:51-91` both say so. Routing app data
//! through this module would move every existing Windows install's files. Only the *user* folders below
//! are resolved here, and they have no such conflict.
//!
//! ## Fallbacks are labelled, not invented
//!
//! A desktop environment without `~/.config/user-dirs.dirs`, or a headless box, answers nothing. The
//! conventional `home/<Name>` is then used and the resolution says so, so a face can show
//! "default, not what the system reported" instead of presenting a made-up path as authoritative.

use std::path::{Path, PathBuf};

/// The user folders this host knows how to name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KnownFolder {
    Pictures,
    Videos,
    Desktop,
    Downloads,
}

impl KnownFolder {
    /// The stable spelling a face or a log line uses. One vocabulary, three faces.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pictures => "pictures",
            Self::Videos => "videos",
            Self::Desktop => "desktop",
            Self::Downloads => "downloads",
        }
    }

    /// The name used when the OS does not report the folder: `home/<conventional name>`.
    #[must_use]
    pub const fn conventional_name(self) -> &'static str {
        match self {
            Self::Pictures => "Pictures",
            Self::Videos => "Videos",
            Self::Desktop => "Desktop",
            Self::Downloads => "Downloads",
        }
    }
}

/// Every folder the host can name, in display order.
pub const ALL_FOLDERS: [KnownFolder; 4] = [
    KnownFolder::Pictures,
    KnownFolder::Videos,
    KnownFolder::Desktop,
    KnownFolder::Downloads,
];

/// Where a resolved path came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FolderSource {
    /// The operating system named it (Known Folder API, standard directories, or XDG user-dirs).
    System,
    /// Nothing was reported, so `home/<conventional name>` was used instead.
    Fallback,
}

/// A folder path plus the honesty about how it was obtained.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedFolder {
    pub folder: KnownFolder,
    pub path: PathBuf,
    pub source: FolderSource,
}

/// Resolve one folder on the running machine.
#[must_use]
pub fn resolve(folder: KnownFolder) -> ResolvedFolder {
    resolve_folder(probe_system(folder), folder, home_dir())
}

/// Resolve every known folder on the running machine, in [`ALL_FOLDERS`] order.
#[must_use]
pub fn resolve_all() -> Vec<ResolvedFolder> {
    ALL_FOLDERS.iter().copied().map(resolve).collect()
}

/// [`resolve`] with the OS probe and the home directory injected, so a test can state a machine that
/// reports nothing, or reports a redirected folder, without changing this host.
#[must_use]
pub fn resolve_with(
    folder: KnownFolder,
    probe: impl Fn(KnownFolder) -> Option<PathBuf>,
    home: PathBuf,
) -> ResolvedFolder {
    resolve_folder(probe(folder), folder, home)
}

fn resolve_folder(reported: Option<PathBuf>, folder: KnownFolder, home: PathBuf) -> ResolvedFolder {
    match reported.filter(|path| !path.as_os_str().is_empty()) {
        Some(path) => ResolvedFolder { folder, path, source: FolderSource::System },
        None => ResolvedFolder {
            folder,
            path: home.join(folder.conventional_name()),
            source: FolderSource::Fallback,
        },
    }
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// The path the OS reports for one folder, or `None` when it reports nothing.
fn probe_system(folder: KnownFolder) -> Option<PathBuf> {
    let reported = match folder {
        KnownFolder::Pictures => dirs::picture_dir(),
        KnownFolder::Videos => dirs::video_dir(),
        KnownFolder::Desktop => dirs::desktop_dir(),
        KnownFolder::Downloads => dirs::download_dir(),
    }?;
    is_usable(&reported).then_some(reported)
}

#[must_use]
fn is_usable(path: &Path) -> bool {
    !path.as_os_str().is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe(mapping: &[(KnownFolder, &str)]) -> impl Fn(KnownFolder) -> Option<PathBuf> {
        let owned: Vec<(KnownFolder, PathBuf)> = mapping
            .iter()
            .map(|(folder, path)| (*folder, PathBuf::from(path)))
            .collect();
        move |folder| {
            owned
                .iter()
                .find(|(candidate, _)| *candidate == folder)
                .map(|(_, path)| path.clone())
        }
    }

    #[test]
    fn every_folder_falls_back_under_the_home_directory_when_the_os_says_nothing() {
        let home = PathBuf::from("/home/xiranite");
        for folder in ALL_FOLDERS {
            let resolved = resolve_folder(None, folder, home.clone());
            assert_eq!(resolved.source, FolderSource::Fallback, "{folder:?}");
            assert_eq!(
                resolved.path,
                home.join(folder.conventional_name()),
                "{folder:?} fallback path"
            );
        }
    }

    #[test]
    fn a_reported_folder_wins_over_the_conventional_name_and_says_so() {
        let redirected = PathBuf::from("/data/图库");
        let resolved = resolve_folder(
            Some(redirected.clone()),
            KnownFolder::Pictures,
            PathBuf::from("/home/xiranite"),
        );
        assert_eq!(resolved.source, FolderSource::System);
        assert_eq!(resolved.path, redirected, "a redirected XDG folder must survive");
    }

    /// A zero-length path is what a partly-broken user-dirs file can produce; treating it as a real
    /// folder would make the fallback unreachable and hand the UI an empty default.
    #[test]
    fn an_empty_reported_path_is_treated_as_no_answer_at_all() {
        let resolved = resolve_folder(
            Some(PathBuf::from("")),
            KnownFolder::Desktop,
            PathBuf::from("/home/xiranite"),
        );
        assert_eq!(resolved.source, FolderSource::Fallback);
        assert_eq!(resolved.path, PathBuf::from("/home/xiranite/Desktop"));
    }

    #[test]
    fn the_probe_and_the_fallback_agree_on_the_running_machine() {
        for folder in ALL_FOLDERS {
            let resolved = resolve(folder);
            assert_eq!(resolved.folder, folder);
            assert!(!resolved.path.as_os_str().is_empty(), "{folder:?} answered nothing");
            match resolved.source {
                FolderSource::System => assert_eq!(probe_system(folder), Some(resolved.path.clone())),
                FolderSource::Fallback => assert!(
                    probe_system(folder).is_none(),
                    "{folder:?} claims a fallback while the OS reports {:?}",
                    probe_system(folder)
                ),
            }
        }
    }

    #[test]
    fn names_are_stable_because_nodes_write_them_into_defaults() {
        let names: Vec<&str> = ALL_FOLDERS.iter().map(|folder| folder.as_str()).collect();
        assert_eq!(names, vec!["pictures", "videos", "desktop", "downloads"]);
        assert_eq!(KnownFolder::Pictures.conventional_name(), "Pictures");
        assert_eq!(KnownFolder::Downloads.conventional_name(), "Downloads");
    }

    #[test]
    fn resolve_with_honours_the_injected_probe() {
        let host = probe(&[(KnownFolder::Videos, "/media/clips")]);
        let resolved = resolve_with(KnownFolder::Videos, host, PathBuf::from("/home/x"));
        assert_eq!(resolved.path, PathBuf::from("/media/clips"));
        assert_eq!(resolved.source, FolderSource::System);
    }
}
