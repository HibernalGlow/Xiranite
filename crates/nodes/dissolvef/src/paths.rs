//! Path text helpers, deliberately separator-neutral.
//!
//! `platform.ts:16-18` hands the core `node:path`'s `join`, `dirname` and `basename`, and
//! `platform.ts:71` resolves every path it stats. Resolution and the real filesystem are host work
//! (`xiranite.fs.*`); the three shaping functions are pure string arithmetic, so they stay in the
//! plugin — which also keeps a plan reproducible on Windows and macOS instead of inheriting whichever
//! `path` module the machine happened to load.
//!
//! Two rules bind this module:
//!
//! - `/` and `\` are both separators, the way `path.win32` reads them, because the shipped product runs
//!   on Windows while the tests and the macOS host use `/`.
//! - Nothing here normalizes away `..`, `.` or repeated separators inside a path. `node:path.join`
//!   would, but it also rewrites `/a/b` into `\\a\\b`; corrupting a POSIX path is worse than preserving
//!   the text the host handed back. `path_depth` and `is_same_or_inside` follow the same rule because
//!   `core.ts:733-743` compares paths as text.
//!
//! Roots (`/`, `D:\`, `\\server\share`) are the part that a naive `rfind` gets wrong, and getting them
//! wrong silently breaks `isFirstLevel` (`core.ts:737`), which compares `dirname(child)` against the root
//! text the host reported.
//!
//! `std::path` cannot do this job even in principle: it picks its separator table by *target*, and
//! `wasm32-unknown-unknown` falls into the Unix arm (only `target_os = "windows"` / `"cygwin"` get `\` as a
//! separator and prefix parsing). A plugin that has to read `D:\a\b` and `/a/b` from the same binary ports
//! `path.win32` by hand, which is what this module is.

/// Both separator characters, as `path.win32` accepts them.
#[must_use]
pub fn is_path_separator(character: char) -> bool {
    matches!(character, '/' | '\\')
}

const fn is_separator_byte(byte: u8) -> bool {
    byte == b'/' || byte == b'\\'
}

/// `runtime.join(...parts)` (`core.ts:105`) with a single separator between two parts.
///
/// Empty parts and `"."` are skipped (`node:path` behaviour); a leading separator on a later part is
/// dropped so `join("/a", "/b")` stays `"/a/b"`. The separator style comes from the text accumulated so
/// far, so a `D:\\a` base never gains a `/` in the middle of a Windows path.
#[must_use]
pub fn join_paths(parts: &[&str]) -> String {
    let mut result = String::new();
    for part in parts {
        if part.is_empty() || *part == "." {
            continue;
        }
        if result.is_empty() {
            result.push_str(part);
            continue;
        }
        let child = trim_leading_separators(part);
        if result.ends_with(is_path_separator) {
            result.push_str(child);
        } else {
            result.push(preferred_separator(&result));
            result.push_str(child);
        }
    }
    result
}

/// The separator nearest the end of `path`, so joined paths keep the host's spelling. `/` when the base
/// carries no separator at all (a bare relative name).
fn preferred_separator(path: &str) -> char {
    path.chars().rev().find(|character| is_path_separator(*character)).unwrap_or('/')
}

/// `runtime.dirname` (`core.ts:106`) — the folder that contains `path`.
///
/// Drive roots (`D:/x` → `D:/`, `D:` → `D:`) and UNC roots (`\\server\share\a` → `\\server\share`, and a
/// UNC root is its own parent) are handled by [`root_prefix_len`] rather than a naive `rfind`. Unlike
/// `path.win32.dirname`, a UNC parent carries no trailing separator: [`join_paths`] has to be able to
/// rebuild the child from it exactly.
#[must_use]
pub fn dirname_of(path: &str) -> String {
    if path.is_empty() {
        return ".".to_string();
    }
    let root_end = root_prefix_len(path);
    let trimmed = trim_trailing_separators(path);
    if trimmed.is_empty() {
        return path[..root_end.max(1)].to_string();
    }
    if trimmed.len() <= root_end {
        // The path is a root, possibly with trailing separators: a root is its own parent.
        return path[..root_end].to_string();
    }
    let tail = &trimmed[root_end..];
    match tail.rfind(is_path_separator) {
        Some(offset) => trimmed[..root_end + offset].to_string(),
        None if root_end == 0 => ".".to_string(),
        None => trimmed[..root_end].to_string(),
    }
}

/// `runtime.basename` (`core.ts:107`) — the last component, which drives the similarity check.
#[must_use]
pub fn basename_of(path: &str) -> String {
    let trimmed = trim_trailing_separators(path);
    if trimmed.is_empty() || is_drive_letter_only(trimmed) {
        return String::new();
    }
    match trimmed.rfind(is_path_separator) {
        Some(index) => trimmed[index + 1..].to_string(),
        None => trimmed.to_string(),
    }
}

/// Byte length of the root prefix of `path`: `D:/` (3), `/` (1), `\\server\share` (whole), or `0` for a
/// relative path. A path is always longer than or equal to this value.
fn root_prefix_len(path: &str) -> usize {
    let bytes = path.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return if bytes.len() >= 3 && is_separator_byte(bytes[2]) { 3 } else { 2 };
    }
    if bytes.len() >= 2 && bytes[0] == b'\\' && bytes[1] == b'\\' {
        return unc_root_len(path);
    }
    if !bytes.is_empty() && is_separator_byte(bytes[0]) {
        return 1;
    }
    0
}

/// `\\server\share` is one root, so its length ends where the share name ends. A `\\server` with no share
/// has only the marker itself as its root.
fn unc_root_len(path: &str) -> usize {
    const MARKER_LEN: usize = 2;
    let Some(server_offset) = path[MARKER_LEN..].find(is_path_separator) else {
        return MARKER_LEN;
    };
    let share_start = MARKER_LEN + server_offset + 1;
    match path[share_start..].find(is_path_separator) {
        Some(share_offset) if share_offset > 0 => share_start + share_offset,
        _ => path.len(),
    }
}

/// `D:` and `C:` name a volume, not a folder: they have no basename and no parent above them.
fn is_drive_letter_only(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

/// `pathDepth` (`core.ts:733-735`): separator runs collapse, empty components drop out.
#[must_use]
pub fn path_depth(path: &str) -> usize {
    path.split(is_path_separator).filter(|part| !part.is_empty()).count()
}

/// `isSameOrInside` (`core.ts:741-743`). Text comparison, exactly as `core.ts` does it: case-sensitive,
/// and no normalization of `..` or repeated separators.
#[must_use]
pub fn is_same_or_inside(path: &str, parent: &str) -> bool {
    if path == parent {
        return true;
    }
    path.strip_prefix(parent)
        .is_some_and(|rest| rest.starts_with(is_path_separator))
}

/// `stripExtension` (`core.ts:745-748`): a leading dot is part of the name, not an extension.
#[must_use]
pub fn strip_extension(name: &str) -> String {
    match name.rfind('.') {
        Some(index) if index > 0 => name[..index].to_string(),
        _ => name.to_string(),
    }
}

/// `splitName` (`core.ts:750-754`): the pair `next_available_path` recombines as
/// `{stem}_{counter}{suffix}`.
#[must_use]
pub fn split_name(name: &str) -> (String, String) {
    match name.rfind('.') {
        Some(index) if index > 0 => (name[..index].to_string(), name[index..].to_string()),
        _ => (name.to_string(), String::new()),
    }
}

fn trim_trailing_separators(path: &str) -> &str {
    let end = path
        .char_indices()
        .rfind(|(_, character)| !is_path_separator(*character))
        .map_or(0, |(index, character)| index + character.len_utf8());
    &path[..end]
}

fn trim_leading_separators(path: &str) -> &str {
    let start = path
        .char_indices()
        .find(|(_, character)| !is_path_separator(*character))
        .map_or(path.len(), |(index, _)| index);
    &path[start..]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basename_accepts_both_separators_and_roots() {
        assert_eq!(basename_of("/root/series_a"), "series_a");
        assert_eq!(basename_of("D:\\root\\series_a"), "series_a");
        assert_eq!(basename_of("D:/root/series_a/"), "series_a");
        assert_eq!(basename_of("series_a"), "series_a");
        assert_eq!(basename_of("/"), "");
        assert_eq!(basename_of("\\"), "");
        assert_eq!(basename_of("D:\\"), "");
        assert_eq!(basename_of("D:"), "");
        assert_eq!(basename_of(""), "");
        assert_eq!(basename_of("\\\\server\\share"), "share");
        assert_eq!(basename_of("\\\\server\\share\\album"), "album");
    }

    #[test]
    fn basename_keeps_case_and_dots_untouched() {
        assert_eq!(basename_of("/Root/Series_A.ZIP"), "Series_A.ZIP");
        assert_eq!(basename_of("a/."), ".");
        assert_eq!(basename_of("a/.."), "..");
        assert_eq!(basename_of("archive.tar.gz"), "archive.tar.gz");
        assert_eq!(basename_of(".hidden.zip"), ".hidden.zip");
    }

    #[test]
    fn dirname_handles_roots_drives_and_unc() {
        assert_eq!(dirname_of("/root/series_a"), "/root");
        assert_eq!(dirname_of("D:\\root\\series_a"), "D:\\root");
        assert_eq!(dirname_of("D:/root/series_a"), "D:/root");
        assert_eq!(dirname_of("D:/x"), "D:/");
        assert_eq!(dirname_of("D:\\x"), "D:\\");
        assert_eq!(dirname_of("D:"), "D:");
        assert_eq!(dirname_of("D:\\"), "D:\\");
        assert_eq!(dirname_of("/a"), "/");
        assert_eq!(dirname_of("/"), "/");
        assert_eq!(dirname_of("//"), "/");
        assert_eq!(dirname_of("\\"), "\\");
        assert_eq!(dirname_of("\\\\"), "\\\\");
        assert_eq!(dirname_of(""), ".");
        assert_eq!(dirname_of("series_a"), ".");
        assert_eq!(dirname_of("\\\\server\\share\\album"), "\\\\server\\share");
        assert_eq!(dirname_of("\\\\server\\share"), "\\\\server\\share");
        assert_eq!(dirname_of("\\\\server\\share\\"), "\\\\server\\share");
    }

    #[test]
    fn dirname_rebuilds_the_child_that_join_produced() {
        // `isFirstLevel` (`core.ts:737`) compares dirname(child) with the root text, so the pair has to
        // round-trip for every separator style the host may hand back.
        for root in ["/root", "D:\\root", "D:/root", "\\\\server\\share"] {
            let child = join_paths(&[root, "album"]);
            assert_eq!(dirname_of(&child), root, "child {child}");
            assert_eq!(basename_of(&child), "album");
        }
    }

    #[test]
    fn dirname_keeps_interior_separator_runs_as_text() {
        assert_eq!(dirname_of("/a//b///c"), "/a//b//");
        assert_eq!(dirname_of("a/./b"), "a/.");
        assert_eq!(dirname_of("a/../b"), "a/..");
    }

    #[test]
    fn join_never_doubles_a_separator_and_follows_the_bases_style() {
        assert_eq!(join_paths(&["/root", "series_a"]), "/root/series_a");
        assert_eq!(join_paths(&["D:/root/", "series_a"]), "D:/root/series_a");
        assert_eq!(join_paths(&["D:\\root", "series_a"]), "D:\\root\\series_a");
        assert_eq!(join_paths(&["", "series_a"]), "series_a");
        assert_eq!(join_paths(&[".", "series_a"]), "series_a");
        assert_eq!(join_paths(&["/root", "", "a", "b"]), "/root/a/b");
        assert_eq!(join_paths(&["/a", "/b"]), "/a/b");
        assert_eq!(join_paths(&["\\\\server\\share", "album"]), "\\\\server\\share\\album");
        assert_eq!(join_paths(&[]), "");
    }

    #[test]
    fn path_depth_counts_components_over_either_separator() {
        assert_eq!(path_depth("/root"), 1);
        assert_eq!(path_depth("/root/album"), 2);
        assert_eq!(path_depth("D:\\root\\album"), 3);
        assert_eq!(path_depth("D:/root//album///"), 3);
        assert_eq!(path_depth(""), 0);
    }

    #[test]
    fn same_or_inside_is_separator_neutral_and_case_sensitive() {
        assert!(is_same_or_inside("/root/album", "/root"));
        assert!(is_same_or_inside("\\\\root\\album", "\\\\root"));
        assert!(is_same_or_inside("/root", "/root"));
        assert!(!is_same_or_inside("/rootalbum", "/root"));
        assert!(!is_same_or_inside("/Root/album", "/root"));
        assert!(!is_same_or_inside("/root/album/x", "/root/album/y"));
    }

    #[test]
    fn name_splitting_matches_core_ts() {
        assert_eq!(strip_extension("series_a.zip"), "series_a");
        assert_eq!(strip_extension("series_a"), "series_a");
        assert_eq!(strip_extension(".hidden"), ".hidden");
        assert_eq!(strip_extension("a.b.c"), "a.b");
        assert_eq!(split_name("archive.tar.gz"), ("archive.tar".to_string(), ".gz".to_string()));
        assert_eq!(split_name("folder"), ("folder".to_string(), String::new()));
        assert_eq!(split_name(".hidden"), (".hidden".to_string(), String::new()));
    }
}
