//! Pure path-text handling for TransQ.
//!
//! Ported from `core.ts:233-236` (`joinPath`) plus the `node:path` calls in
//! `platform.ts` (`basename`, `dirname`, `join`). The plugin keeps this in Rust,
//! not in the host, because queue identity, output placement and copy targets are
//! TransQ domain rules; the host only executes the resulting paths and enforces
//! its `allowed_paths` on them (ADR-0066).
//!
//! Deviation worth recording: Node's `path.win32.join` rewrites `/` into `\`, so
//! the TypeScript node's child paths on Windows came out backslashed even when the
//! user typed forward slashes. This port preserves the parent's separator instead,
//! which matches `joinPath`'s existing rule, keeps the tested strings stable
//! (`core.test.ts:22-26`), and leaves canonicalization to the host that actually
//! opens the file.

/// The separator `joinPath` infers for a parent path (`core.ts:234`).
pub fn inferred_path_separator(parent: &str) -> char {
    if parent.contains('\\') { '\\' } else { '/' }
}

fn is_path_separator(character: char) -> bool {
    character == '/' || character == '\\'
}

/// `parent.replace(/[\\/]+$/, ""))` then one separator then `name` (`core.ts:235`).
pub fn join_path(parent: &str, name: &str) -> String {
    let trimmed = parent.trim_end_matches(is_path_separator);
    let separator = inferred_path_separator(parent);
    if name.is_empty() {
        return trimmed.to_string();
    }
    if trimmed.is_empty() {
        return format!("{separator}{name}");
    }
    format!("{trimmed}{separator}{name}")
}

/// `path.dirname`. Covers the shapes TransQ produces: an absolute workspace path
/// whose parent is the project folder, which is where the final `result` folder of
/// a queue goes (`platform.ts:75`).
pub fn directory_name(path: &str) -> String {
    let trimmed = trim_trailing_separators(path);
    let separators: Vec<usize> = trimmed
        .char_indices()
        .filter(|(_, character)| is_path_separator(*character))
        .map(|(index, _)| index)
        .collect();

    match separators.last() {
        None => ".".to_string(),
        Some(0) => trimmed[..1].to_string(),
        Some(index) => {
            let parent = &trimmed[..*index];
            // `dirname("C:\photos")` is `C:\`, not `C:`: a bare drive root keeps
            // its separator, otherwise the composed output path escapes the drive.
            if is_windows_drive_root(parent) {
                format!("{parent}{}", inferred_path_separator(path))
            } else {
                parent.to_string()
            }
        }
    }
}

/// `path.basename`, trailing separators ignored first.
pub fn base_name(path: &str) -> String {
    let trimmed = trim_trailing_separators(path);
    match trimmed.rfind(is_path_separator) {
        Some(index) => trimmed[index + 1..].to_string(),
        None => trimmed.to_string(),
    }
}

fn is_windows_drive_root(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn trim_trailing_separators(path: &str) -> &str {
    let trimmed = path.trim_end_matches(is_path_separator);
    // A path that is nothing but separators is a root, and Node keeps it intact.
    if trimmed.is_empty() { path } else { trimmed }
}

/// `String.trim()`: the JS set also strips U+FEFF, which Rust's `char::is_whitespace`
/// does not consider whitespace, so pasted Windows paths keep trimming cleanly.
pub fn trim_js_whitespace(value: &str) -> &str {
    let is_trimmed = |character: char| character.is_whitespace() || character == '\u{FEFF}';
    let start = value
        .char_indices()
        .find(|(_, character)| !is_trimmed(*character))
        .map_or(value.len(), |(index, _)| index);
    let end = value
        .char_indices()
        .rev()
        .find(|(_, character)| !is_trimmed(*character))
        .map_or(0, |(index, character)| index + character.len_utf8());
    // All-whitespace input leaves `start > end`, which `get` reports as `None`.
    value.get(start..end).unwrap_or_default()
}

/// `path.replace(/^['"]|['"]$/g, "")` from `core.ts:67`: at most one quote removed
/// from each end, evaluated against the original string.
pub fn strip_surrounding_quotes(value: &str) -> &str {
    let without_leading = match value.strip_prefix(['\'', '"']) {
        Some(rest) => rest,
        None => value,
    };
    if without_leading.is_empty() {
        return without_leading;
    }
    without_leading.strip_suffix(['\'', '"']).unwrap_or(without_leading)
}

/// `parseTransqPaths` (`core.ts:66-68`): trim, drop one wrapping quote per side,
/// then discard what remains empty.
pub fn parse_transq_paths(paths: &[String]) -> Vec<String> {
    paths
        .iter()
        .map(|path| strip_surrounding_quotes(trim_js_whitespace(path)).to_string())
        .filter(|path| !path.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_like_the_typescript_joinpath() {
        assert_eq!(
            join_path("D:/translation/chapter/original_images", "002.png"),
            "D:/translation/chapter/original_images/002.png"
        );
        assert_eq!(
            join_path("D:\\translation\\chapter", "result"),
            "D:\\translation\\chapter\\result"
        );
        assert_eq!(join_path("D:/translation/", "result"), "D:/translation/result");
        assert_eq!(join_path("/", "result"), "/result");
    }

    #[test]
    fn derives_the_final_output_folder() {
        assert_eq!(
            directory_name("D:/translation/chapter/original_images"),
            "D:/translation/chapter"
        );
        assert_eq!(directory_name("D:\\a\\b\\original_images"), "D:\\a\\b");
        assert_eq!(directory_name("C:/a"), "C:/");
        assert_eq!(directory_name("/a"), "/");
        assert_eq!(directory_name("a"), ".");
    }

    #[test]
    fn reads_the_queue_folder_name() {
        assert_eq!(base_name("D:/translation/chapter/original_images"), "original_images");
        assert_eq!(base_name("D:/translation/chapter/original_images/"), "original_images");
        assert_eq!(base_name("D:\\a\\B"), "B");
    }

    #[test]
    fn parses_cli_and_pasted_paths() {
        let raw = [
            "  D:/translation/chapter  ".to_string(),
            "'D:/quoted/chapter'".to_string(),
            "\"D:/double/chapter\"".to_string(),
            "   ".to_string(),
            "".to_string(),
            "\u{FEFF}D:/bom/chapter\u{FEFF}".to_string(),
        ];
        assert_eq!(
            parse_transq_paths(&raw),
            vec![
                "D:/translation/chapter".to_string(),
                "D:/quoted/chapter".to_string(),
                "D:/double/chapter".to_string(),
                "D:/bom/chapter".to_string(),
            ]
        );
    }

    #[test]
    fn strips_only_one_quote_per_side() {
        assert_eq!(strip_surrounding_quotes("'a'"), "a");
        assert_eq!(strip_surrounding_quotes("'a"), "a");
        assert_eq!(strip_surrounding_quotes("a'"), "a");
        assert_eq!(strip_surrounding_quotes("'''"), "'");
        assert_eq!(strip_surrounding_quotes("'"), "");
        assert_eq!(strip_surrounding_quotes("a'b'c"), "a'b'c");
    }
}
