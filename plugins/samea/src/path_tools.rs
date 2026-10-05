//! The three path text operations `platform.ts:14` imports from `node:path`, plus `normalizePath`.
//!
//! ADR-0071 §5 is the reason this module is small: a `wasm32-wasip1` guest inherits **POSIX** path
//! semantics even when the host is Windows (`std::path::is_separator('\\')` is `false` there, and
//! `Path::new("C:\\windows")` is one component), so plugin-side path work is limited to the WASI view.
//! Anything needing drive letters, UNC prefixes or case-insensitive comparison belongs to the host, not
//! to this crate. SameA only ever builds `join(root, "[Artist]", fileName)` and asks whether a normalized
//! target equals its own source, which the WASI view expresses exactly.
//!
//! Parity notes against the two runtimes the TypeScript saw:
//! * `platform.ts:14` used `node:path`, which is win32-shaped on Windows; the fixture inside the node's
//!   own test (`core.test.ts:84-85`) is POSIX-shaped. These helpers follow the POSIX reading, which is
//!   what the guest will actually execute, and which agrees with the fixture for every path SameA builds
//!   (roots, artist folders and archive names, all separator-free inside a segment).
//! * `path_dirname` returns `"."` and `path_basename` trims trailing separators, i.e. `node:path/posix`,
//!   not the fixture's `|| "/"` fallback. Neither difference is reachable: `dirname` is only called on a
//!   plan target (`core.ts:113`), which always carries a separator because it is
//!   `join(group.targetDir, sourceName)`, and `basename` is only called on a root (`core.ts:133`), where
//!   a trailing slash is the user typing the same directory twice.

/// The one separator the WASI view recognises.
const SEPARATOR: char = '/';

/// `node:path.join(...parts)` over the POSIX view: empty segments drop, repeated separators collapse,
/// a leading separator survives as exactly one root, and `"."` segments disappear.
///
/// `..` segments are kept literally. `node:path` would resolve them, but no SameA path contains one:
/// every segment comes from a user-typed root, a directory entry name, or an artist label built by
/// [`crate::artist::extract_artist`], and an entry name can never be `".."` because `read_dir` does not
/// report it.
#[must_use]
pub fn path_join(parts: &[&str]) -> String {
    // Rootedness comes from the first non-empty part: `node:path/posix.join("", "/archive")` and
    // `core.test.ts:84`'s `parts.join("/").replace(/\/{2,}/g, "/")` both answer `"/archive"`, while
    // `join("a", "/b")` answers `"a/b"` because a later leading slash is not a root.
    let rooted =
        parts.iter().find(|part| !part.is_empty()).is_some_and(|first| first.starts_with(SEPARATOR));
    let mut segments: Vec<&str> = Vec::new();
    for part in parts.iter().filter(|part| !part.is_empty()) {
        for segment in part.split(SEPARATOR) {
            if segment.is_empty() || segment == "." {
                continue;
            }
            segments.push(segment);
        }
    }
    if segments.is_empty() {
        return if rooted { SEPARATOR.to_string() } else { ".".to_string() };
    }
    let joined = segments.join(&SEPARATOR.to_string());
    if rooted { format!("{SEPARATOR}{joined}") } else { joined }
}

/// `node:path/posix.dirname`: the text up to the last separator, `"/"` for a top-level name, `"."` when
/// there is no separator at all.
#[must_use]
pub fn path_dirname(path: &str) -> String {
    let trimmed = trim_trailing_separators(path);
    let Some(cut) = trimmed.rfind(SEPARATOR) else {
        return ".".to_string();
    };
    if cut == 0 { SEPARATOR.to_string() } else { trimmed[..cut].to_string() }
}

/// `node:path/posix.basename`: the last segment, ignoring trailing separators.
#[must_use]
pub fn path_basename(path: &str) -> String {
    let trimmed = trim_trailing_separators(path);
    match trimmed.rfind(SEPARATOR) {
        Some(cut) => trimmed[cut + 1..].to_string(),
        None => trimmed.to_string(),
    }
}

/// `normalizePath` (`core.ts:252`): backslashes to forward slashes, then lowercase.
///
/// Ported verbatim rather than reinterpreted, because it is the *same-path* test at `core.ts:159`
/// ("the target is exactly where the archive already sits") and both branches of that comparison feed
/// the reported `status`/`reason`. Lowercasing is a whole-string fold, so a case-folded `D:\A` root and
/// a `d:/a` target compare equal — the host may not have a case-insensitive filesystem, but SameA's own
/// rule (as written in TypeScript) treats them as the same place.
#[must_use]
pub fn normalize_path(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

fn trim_trailing_separators(path: &str) -> &str {
    let bytes = path.as_bytes();
    let mut end = bytes.len();
    while end > 1 && bytes[end - 1] == b'/' {
        end -= 1;
    }
    &path[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_collapses_separators_and_keeps_one_root() {
        // `core.ts:158`: join(group.targetDir, sourceName).
        assert_eq!(path_join(&["/archive/[Artist]", "[Artist] one.zip"]), "/archive/[Artist]/[Artist] one.zip");
        // `core.ts:207`: join(base, artist.label) where base is the root.
        assert_eq!(path_join(&["/archive/", "[Artist]"]), "/archive/[Artist]");
        assert_eq!(path_join(&["/archive", "/[Artist]"]), "/archive/[Artist]", "only the leading root survives");
        assert_eq!(path_join(&["", "/archive"]), "/archive", "an empty part contributes nothing");
        assert_eq!(path_join(&["archive", "[Artist]"]), "archive/[Artist]");
        assert_eq!(path_join(&[]), ".");
        assert_eq!(path_join(&["/"]), "/");
    }

    #[test]
    fn dirname_and_basename_are_the_posix_reading() {
        assert_eq!(path_dirname("/archive/[Artist]/a.zip"), "/archive/[Artist]");
        assert_eq!(path_dirname("/archive/a.zip"), "/archive");
        assert_eq!(path_dirname("/a.zip"), "/");
        assert_eq!(path_basename("/archive/[Artist] one.zip"), "[Artist] one.zip");
        assert_eq!(path_basename("/archive/"), "archive");
        assert_eq!(path_basename("a.zip"), "a.zip");
    }

    #[test]
    fn normalize_path_folds_backslashes_and_case() {
        // `core.ts:159` compares `D:\A\[X] a.zip` with `d:/a/[x] a.zip` as equal.
        assert_eq!(normalize_path(r"D:\A\[X] a.zip"), "d:/a/[x] a.zip");
        assert_eq!(normalize_path("/archive/a.ZIP"), "/archive/a.zip");
        // Negative control: a different name never normalizes to the same text.
        assert_ne!(normalize_path("/archive/a.zip"), normalize_path("/archive/b.zip"));
    }
}
