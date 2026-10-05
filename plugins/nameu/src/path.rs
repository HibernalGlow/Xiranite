//! Separator-agnostic path shaping for the plugin.
//!
//! The TypeScript delegates `join`/`dirname`/`basename` to `node:path`
//! (`packages/nodes/nameu/src/platform.ts:2-6`), whose rules differ per host
//! OS. A WASM plugin must not bake one OS in, so these helpers accept both
//! separators and the [`crate::plan::NameuRuntime`] trait keeps them
//! host-overridable for exact `node:path` behaviour.

pub(crate) const SEPARATORS: [char; 2] = ['/', '\\'];

fn is_separator(ch: char) -> bool {
    SEPARATORS.contains(&ch)
}

/// The separator a joined path should reuse: the last one seen in `parent`, so
/// Windows plans keep `\` and POSIX plans keep `/`.
fn dominant_separator(parent: &str) -> char {
    parent.chars().rev().find(|ch| is_separator(*ch)).unwrap_or('/')
}

fn trim_trailing_separators(value: &str) -> &str {
    let mut end = value.len();
    while end > 0 && is_separator(value.as_bytes()[end - 1] as char) {
        // Both separators are one byte, so byte indexing stays on a boundary.
        end -= 1;
    }
    if end == 0 && !value.is_empty() {
        // All separators: keep one so a root stays a root.
        return &value[value.len() - 1..];
    }
    &value[..end]
}

fn trim_leading_separators(value: &str) -> &str {
    let mut start = 0;
    while start < value.len() && is_separator(value.as_bytes()[start] as char) {
        start += 1;
    }
    &value[start..]
}

fn starts_with_drive_prefix(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

/// `path.join` for the two-segment use in `planTarget` (core.ts:211), generalised
/// to N segments. Empty parts are dropped instead of raising, because a plugin
/// input path may be blank after cleaning.
pub fn join_paths(parts: &[&str]) -> String {
    let mut out = String::new();
    for part in parts.iter().filter(|part| !part.is_empty()) {
        if out.is_empty() {
            out.push_str(part);
            continue;
        }
        let separator = dominant_separator(&out);
        let parent = trim_trailing_separators(&out).to_string();
        let child = trim_leading_separators(part).to_string();
        out = format!("{parent}{separator}{child}");
    }
    out
}

/// `path.dirname` with both separators recognised; `"."` for a bare name,
/// matching the runtime stub in `core.test.ts:83`.
pub fn dirname_of(path: &str) -> String {
    let trimmed = trim_trailing_separators(path);
    let Some(index) = trimmed.rfind(SEPARATORS) else {
        return ".".to_string();
    };
    let parent = trim_trailing_separators(&trimmed[..index]);
    if parent.is_empty() {
        return trimmed[..index + 1].to_string();
    }
    // `D:` alone is a drive-relative location; `node:path` on Windows reports
    // `D:\`, and keeping the separator makes the later `join_paths` win too.
    if starts_with_drive_prefix(parent) {
        return format!("{parent}{}", trimmed.as_bytes()[index] as char);
    }
    parent.to_string()
}

/// `path.basename` tolerant of both separators and of trailing separators.
pub fn basename_of(path: &str) -> String {
    path.split(SEPARATORS)
        .filter(|segment| !segment.is_empty())
        .next_back()
        .map_or_else(|| path.to_string(), ToString::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_uses_the_parent_separator() {
        assert_eq!(join_paths(&["/library/Artist", "Book.zip"]), "/library/Artist/Book.zip");
        assert_eq!(join_paths(&["D:\\archives\\Artist", "Book.zip"]), "D:\\archives\\Artist\\Book.zip");
        assert_eq!(join_paths(&["/library/Artist/", "/Book.zip"]), "/library/Artist/Book.zip");
    }

    #[test]
    fn dirname_matches_the_typescript_stub() {
        assert_eq!(dirname_of("/library/Artist/Book.zip"), "/library/Artist");
        assert_eq!(dirname_of("Book.zip"), ".");
        assert_eq!(dirname_of("/Book.zip"), "/");
        assert_eq!(dirname_of("D:\\archives\\Artist"), "D:\\archives");
        assert_eq!(dirname_of("D:\\Artist"), "D:\\");
        assert_eq!(dirname_of("/library/Artist/"), "/library");
    }

    #[test]
    fn basename_skips_empty_segments() {
        assert_eq!(basename_of("/library/Artist"), "Artist");
        assert_eq!(basename_of("D:\\archives\\Artist\\"), "Artist");
        assert_eq!(basename_of("Artist"), "Artist");
        assert_eq!(basename_of("/"), "/");
    }
}
