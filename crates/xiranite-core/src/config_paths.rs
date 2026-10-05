//! Which document the product reads, answered in one place.
//!
//! `packages/config/src/paths.ts:24-37` is the contract this mirrors, in the same order: an explicit
//! `XIRANITE_CONFIG_PATH`, then the directory of `XIRANITE_DATABASE_PATH`, then `XIRANITE_DATA_DIR`,
//! then the platform data root. The CLI, the realm and the HTTP host all have to land on the same
//! file, so a route that rebuilt this logic for itself would be reading a different document than the
//! node it claims to configure.
//!
//! `themes.json` is resolved as a sibling of the document rather than as a second platform root
//! (`packages/services/src/configService.ts:589`): pointing `XIRANITE_CONFIG_PATH` somewhere else
//! moves the theme file with it, which is what makes a portable setup one directory instead of two.

use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

/// The shared document's file name. Same spelling as `XIRANITE_CONFIG_FILENAME` in `paths.ts:5`.
pub const CONFIG_FILENAME: &str = "xiranite.config.toml";

/// The custom-theme sidecar that lives next to the document.
pub const THEMES_FILENAME: &str = "themes.json";

/// The three platforms the product ships on; `packages/platform/src/index.ts:37-40` refuses anything else.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Windows,
    MacOS,
    Linux,
}

/// Everything the resolution needs, held as data so a test can state a whole machine in one value.
#[derive(Debug, Clone)]
pub struct PathContext {
    pub platform: Platform,
    pub home: PathBuf,
    pub cwd: PathBuf,
    vars: BTreeMap<String, String>,
}

impl PathContext {
    /// The real machine's context: process working directory, home, and the environment.
    #[must_use]
    pub fn from_environment() -> Self {
        let platform = match std::env::consts::OS {
            "windows" => Platform::Windows,
            "macos" => Platform::MacOS,
            _ => Platform::Linux,
        };
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/"));
        let vars = std::env::vars().collect();
        Self { platform, home, cwd: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")), vars }
    }

    /// A context with an explicit variable table: the seam for a test that wants to state a whole machine.
    #[must_use]
    pub fn with_vars(
        platform: Platform,
        home: impl Into<PathBuf>,
        cwd: impl Into<PathBuf>,
        vars: &[(&str, &str)],
    ) -> Self {
        Self {
            platform,
            home: home.into(),
            cwd: cwd.into(),
            vars: vars.iter().map(|(key, value)| ((*key).to_string(), (*value).to_string())).collect(),
        }
    }

    /// `XIRANITE_CONFIG_PATH` → `XIRANITE_DATABASE_PATH`'s directory → `XIRANITE_DATA_DIR` → platform root.
    #[must_use]
    pub fn config_path(&self) -> PathBuf {
        if let Some(raw) = self.var("XIRANITE_CONFIG_PATH") {
            return resolve(&self.cwd, Path::new(raw));
        }
        if let Some(raw) = self.var("XIRANITE_DATABASE_PATH") {
            let database = resolve(&self.cwd, Path::new(raw));
            let dir = database.parent().map_or_else(|| self.cwd.clone(), Path::to_path_buf);
            return resolve(&dir, Path::new(CONFIG_FILENAME));
        }
        if let Some(raw) = self.var("XIRANITE_DATA_DIR") {
            let dir = resolve(&self.cwd, Path::new(raw));
            return resolve(&dir, Path::new(CONFIG_FILENAME));
        }
        resolve(&self.data_dir(), Path::new(CONFIG_FILENAME))
    }

    /// The theme sidecar that belongs to [`Self::config_path`].
    #[must_use]
    pub fn themes_path(&self) -> PathBuf {
        let dir = self.config_path().parent().map_or_else(|| self.cwd.clone(), Path::to_path_buf);
        resolve(&dir, Path::new(THEMES_FILENAME))
    }

    /// The per-user data root, spelled the way `resolveAppDataDir` spells it (`packages/platform/src/index.ts:56-61`).
    #[must_use]
    pub fn data_dir(&self) -> PathBuf {
        match self.platform {
            Platform::Windows => {
                let base = self
                    .var("LOCALAPPDATA")
                    .or_else(|| self.var("APPDATA"))
                    .map(Path::new)
                    .map_or_else(|| self.home.join("AppData").join("Local"), Path::to_path_buf);
                base.join("Xiranite")
            }
            Platform::MacOS => self.home.join("Library").join("Application Support").join("Xiranite"),
            Platform::Linux => {
                let base = self
                    .var("XDG_DATA_HOME")
                    .map(Path::new)
                    .map_or_else(|| self.home.join(".local").join("share"), Path::to_path_buf);
                base.join("xiranite")
            }
        }
    }

    fn var(&self, name: &str) -> Option<&str> {
        self.vars.get(name).map(String::as_str).filter(|value| !value.trim().is_empty())
    }
}

/// `path.resolve(cwd, raw)` without the platform-specific drive-letter rules: absolutise, then cancel
/// `.` and `..` textually so a value like `../x/xiranite.config.toml` names the same file the CLI means.
fn resolve(base: &Path, raw: &Path) -> PathBuf {
    if raw.is_absolute() { return normalize(raw); }
    normalize(&base.join(raw))
}

fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() { out.push(".."); }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(platform: Platform, vars: &[(&str, &str)]) -> PathContext {
        PathContext::with_vars(platform, PathBuf::from("/home/tester"), PathBuf::from("/work/cwd"), vars)
    }

    #[test]
    fn an_explicit_config_path_beats_everything_else() {
        let ctx = context(
            Platform::MacOS,
            &[
                ("XIRANITE_CONFIG_PATH", "/elsewhere/xiranite.config.toml"),
                ("XIRANITE_DATABASE_PATH", "/db/dir/xiranite.db"),
                ("XIRANITE_DATA_DIR", "/data"),
            ],
        );
        assert_eq!(ctx.config_path(), PathBuf::from("/elsewhere/xiranite.config.toml"));
    }

    #[test]
    fn a_database_path_lends_its_directory() {
        let ctx = context(Platform::MacOS, &[("XIRANITE_DATABASE_PATH", "/volumes/box/xiranite.db")]);
        assert_eq!(ctx.config_path(), PathBuf::from("/volumes/box/xiranite.config.toml"));
    }

    #[test]
    fn a_data_dir_or_a_relative_override_is_joined_against_the_working_directory() {
        let ctx = context(Platform::MacOS, &[("XIRANITE_DATA_DIR", "data")]);
        assert_eq!(ctx.config_path(), PathBuf::from("/work/cwd/data/xiranite.config.toml"));
        let relative = context(Platform::MacOS, &[("XIRANITE_CONFIG_PATH", "../shared/a.toml")]);
        assert_eq!(relative.config_path(), PathBuf::from("/work/shared/a.toml"));
    }

    #[test]
    fn each_platform_gets_its_own_documented_root() {
        assert_eq!(
            context(Platform::MacOS, &[]).config_path(),
            PathBuf::from("/home/tester/Library/Application Support/Xiranite/xiranite.config.toml")
        );
        assert_eq!(
            context(Platform::Windows, &[("LOCALAPPDATA", "C:\\Users\\me\\AppData\\Local")]).config_path(),
            PathBuf::from("C:\\Users\\me\\AppData\\Local/Xiranite/xiranite.config.toml")
        );
        assert_eq!(
            context(Platform::Linux, &[("XDG_DATA_HOME", "/srv/data")]).config_path(),
            PathBuf::from("/srv/data/xiranite/xiranite.config.toml")
        );
    }

    /// Windows falls back to APPDATA only when LOCALAPPDATA is absent — the order `index.ts:51-53` states.
    #[test]
    fn windows_prefers_local_app_data_and_falls_back_to_roaming() {
        let roaming = context(Platform::Windows, &[("APPDATA", "R")]);
        assert_eq!(roaming.data_dir(), PathBuf::from("R/Xiranite"));
        let both = context(Platform::Windows, &[("APPDATA", "R"), ("LOCALAPPDATA", "L")]);
        assert_eq!(both.data_dir(), PathBuf::from("L/Xiranite"));
    }

    #[test]
    fn themes_follow_the_document_not_the_platform_root() {
        let ctx = context(Platform::MacOS, &[("XIRANITE_CONFIG_PATH", "/portable/xiranite.config.toml")]);
        assert_eq!(ctx.themes_path(), PathBuf::from("/portable/themes.json"));
        let default = context(Platform::MacOS, &[]);
        assert_eq!(
            default.themes_path(),
            PathBuf::from("/home/tester/Library/Application Support/Xiranite/themes.json")
        );
    }
}
