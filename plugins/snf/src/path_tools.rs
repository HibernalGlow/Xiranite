//! Path text helpers, kept pure.
//!
//! `platform.ts:23-25` hands the core `node:path`'s `join`, `dirname` and
//! `basename`. Those three are string arithmetic — they never touch the machine —
//! so they port into the plugin instead of becoming host functions, which also
//! keeps the plan deterministic across platforms (ADR-0063 forbids a plugin from
//! reaching `std::fs`).
//!
//! The flavour is deliberately both-separator: `\\` and `/` are both path
//! separators, the way `path.win32` treats them, because the shipped product runs
//! on Windows while the tests and the future Linux/macOS host adapters use `/`.
//! Where the production `node:path` and the test double in `core.test.ts:74-76`
//! disagree, `node:path` wins and the disagreement is recorded on the function.

/// Both separator characters, as `path.win32` accepts them.
const fn is_path_separator(character: char) -> bool {
    matches!(character, '/' | '\\')
}

/// `path.join(parent, child)` with a single separator between them.
///
/// Empty children and the `"."` root of a relative path are skipped, which is
/// `node:path` behaviour; the `core.test.ts` double would have produced
/// `"./1. CG"` for a bare folder name.
#[must_use]
pub fn join_folder_path(parent: &str, child: &str) -> String {
    if child.is_empty() || child == "." {
        return parent.to_string();
    }
    if parent.is_empty() {
        return child.to_string();
    }
    if parent == "." {
        return child.to_string();
    }
    if parent.ends_with(is_path_separator) {
        return format!("{parent}{child}");
    }
    format!("{parent}{}{child}", preferred_separator(parent))
}

/// The separator style already in use at the end of `parent`, so a `D:\\a` base
/// does not gain a `/` in the middle of a Windows path.
fn preferred_separator(path: &str) -> char {
    path.chars()
        .rev()
        .find(|character| is_path_separator(*character))
        .unwrap_or('/')
}

/// `path.dirname` — the folder that contains `path`.
#[must_use]
pub fn parent_directory(path: &str) -> String {
    let trimmed = trim_trailing_separators(path);
    if trimmed.is_empty() && !path.is_empty() {
        // A path made only of separators is already a root: `/` and `D:\` have no
        // parent to strip, and `node:path` answers with the root itself.
        return path[..1].to_string();
    }
    let Some(index) = trimmed.rfind(is_path_separator) else {
        return ".".to_string();
    };
    if index == 0 {
        return trimmed[..1].to_string();
    }
    let prefix = &trimmed[..index];
    if prefix.chars().all(is_path_separator) {
        return prefix[..1].to_string();
    }
    if is_windows_drive_root(prefix) {
        return format!("{prefix}{}", preferred_separator(trimmed));
    }
    prefix.to_string()
}

/// `C:` and `D:` are not a folder name: their parent is `C:\\`.
fn is_windows_drive_root(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

/// `path.basename` — the last path component, the label SNF renumbers.
#[must_use]
pub fn folder_name(path: &str) -> String {
    let trimmed = trim_trailing_separators(path);
    if trimmed.is_empty() {
        return path.to_string();
    }
    match trimmed.rfind(is_path_separator) {
        Some(index) => trimmed[index + 1..].to_string(),
        None => trimmed.to_string(),
    }
}

fn trim_trailing_separators(path: &str) -> &str {
    let end = path
        .char_indices()
        .rfind(|(_, character)| !is_path_separator(*character))
        .map_or(0, |(index, character)| index + character.len_utf8());
    &path[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_name_mirrors_basename() {
        assert_eq!(folder_name("/library/Artist"), "Artist");
        assert_eq!(folder_name("D:\\Library\\Artist\\"), "Artist");
        assert_eq!(folder_name("Artist"), "Artist");
        assert_eq!(folder_name("/"), "/");
    }

    #[test]
    fn parent_directory_mirrors_dirname() {
        assert_eq!(parent_directory("/library/Artist/3. CG"), "/library/Artist");
        assert_eq!(parent_directory("D:\\a\\b\\3. CG"), "D:\\a\\b");
        assert_eq!(parent_directory("Artist"), ".");
        assert_eq!(parent_directory("/library"), "/");
        assert_eq!(parent_directory("D:\\a"), "D:\\");
        assert_eq!(parent_directory("D:\\a\\"), "D:\\a");
        assert_eq!(parent_directory("/"), "/");
        assert_eq!(parent_directory(""), ".");
    }

    #[test]
    fn join_never_doubles_a_separator() {
        assert_eq!(join_folder_path("/library/Artist", "1. CG"), "/library/Artist/1. CG");
        assert_eq!(join_folder_path("D:/a/", "1. CG"), "D:/a/1. CG");
        assert_eq!(join_folder_path("D:\\a", "1. CG"), "D:\\a\\1. CG");
        assert_eq!(join_folder_path(".", "1. CG"), "1. CG");
        assert_eq!(join_folder_path("", "1. CG"), "1. CG");
    }

    #[test]
    fn a_renumbered_target_rebuilds_the_source_path() {
        let source = "D:\\Library\\Artist\\9. 同人志";
        let target_name = "1. 同人志";
        assert_eq!(
            join_folder_path(&parent_directory(source), target_name),
            "D:\\Library\\Artist\\1. 同人志"
        );
    }
}
