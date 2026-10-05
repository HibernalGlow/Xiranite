//! Path text operations, ported so plan generation and record keys stay pure.
//!
//! The TypeScript core reached these through `TimeuRuntime` (`core.ts:73-75`) and
//! `node:path` (`platform.ts:2`), but they are string operations on already
//! authorized text: no filesystem entry is opened, resolved or stat'ed here. The
//! real `path.resolve` behind `platform.ts:27` stays a host responsibility, and
//! the host returns the resolved path inside `TimeuPathInfo.path`.
//!
//! `node:path` is win32 on the only shipping host today, so these tolerate both
//! separators and drive roots. Deliberate limits, because the record file only
//! ever stores the text the host handed back:
//!
//! - separator style is preserved rather than rewritten (win32 `path.join` always
//!   emits `\`);
//! - UNC roots keep their leading double separator but are otherwise treated like
//!   any rooted path, so `\\server\share\dir` behaves as `//server/share/dir`;
//! - `path_dirname` of a bare root returns the root, matching win32 behaviour for
//!   the shapes TimeU produces (`C:\file.txt` -> `C:\`).

use std::cmp::Ordering;

/// Both separators, because inputs arrive from a Windows card and from a POSIX
/// CLI interchangeably.
fn is_separator(character: char) -> bool {
    character == '/' || character == '\\'
}

/// `path.replace(/\\/g, "/").toLowerCase()` (`core.ts:255`), the key every
/// path-equality decision in TimeU makes: restore matching (`core.ts:191`),
/// record merging (`core.ts:213`) and record-file de-duplication.
pub fn normalize_path_key(path: &str) -> String {
    let mut key = String::with_capacity(path.len());
    for character in path.chars() {
        if character == '\\' {
            key.push('/');
        } else {
            key.extend(character.to_lowercase());
        }
    }
    key
}

/// Separator style of the text, defaulting to `/` for a separator-free input.
fn dominant_separator(segments: &[&str]) -> char {
    segments
        .iter()
        .flat_map(|segment| segment.chars())
        .find(|character| is_separator(*character))
        .unwrap_or('/')
}

fn trim_leading_separators(segment: &str) -> &str {
    let mut index = 0usize;
    let characters: Vec<char> = segment.chars().collect();
    while index < characters.len() && is_separator(characters[index]) {
        index += 1;
    }
    &segment[segment
        .char_indices()
        .nth(index)
        .map(|(byte, _)| byte)
        .unwrap_or(segment.len())..]
}

fn trim_trailing_separators(path: &str) -> String {
    let mut characters: Vec<char> = path.chars().collect();
    while characters.last().is_some_and(|character| is_separator(*character)) {
        characters.pop();
    }
    characters.into_iter().collect()
}

/// `path.join(...parts)` with the `.` segments `node:path` drops, empty segments
/// it skips, and the separator style of the input kept.
pub fn path_join(parts: &[&str]) -> String {
    let mut segments: Vec<&str> = parts.iter().copied().filter(|part| !part.is_empty()).collect();
    segments.retain(|segment| *segment != ".");
    if segments.is_empty() {
        return ".".to_string();
    }

    let separator = dominant_separator(&segments);
    let mut joined = String::new();
    for (index, &segment) in segments.iter().enumerate() {
        let head = trim_leading_separators(segment);
        if index == 0 {
            if let Some(first) = segment.chars().next() {
                if is_separator(first) {
                    // Rooted input keeps exactly one root separator unless it is
                    // a UNC-style double leading separator.
                    let leading_run = segment.chars().take_while(|c| *c == first).count();
                    if leading_run >= 2 && first == '\\' {
                        joined.push('\\');
                    }
                    joined.push(separator);
                }
            }
            joined.push_str(head);
            continue;
        }

        let base = trim_trailing_separators(&joined);
        if base.is_empty() {
            // `joined` is still the bare root, so the separator is already there.
            joined.push_str(head);
        } else {
            joined = base;
            joined.push(separator);
            joined.push_str(head);
        }
    }

    if joined.is_empty() { ".".to_string() } else { joined }
}

/// `path.dirname(path)`, used by `defaultRecordPath` (`core.ts:245-248`) and by
/// `ensureDir(runtime.dirname(recordPath))` (`core.ts:120`).
pub fn path_dirname(path: &str) -> String {
    let characters: Vec<char> = path.chars().collect();
    let mut end = characters.len();
    while end > 0 && is_separator(characters[end - 1]) {
        end -= 1;
    }

    let mut cut: Option<usize> = None;
    let mut index = 0usize;
    while index < end {
        if is_separator(characters[index]) {
            cut = Some(index);
        }
        index += 1;
    }

    let Some(cut) = cut else {
        return ".".to_string();
    };
    let mut prefix: String = characters[..cut].iter().collect();
    if prefix.is_empty() {
        return characters[..1].iter().collect();
    }
    if is_drive_root(&prefix) {
        // win32.dirname("D:\file.txt") is "D:\", not "D:".
        prefix.push(characters[cut]);
    }
    prefix
}

fn is_drive_root(prefix: &str) -> bool {
    let bytes = prefix.as_bytes();
    bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

/// `path.basename(path)`. `TimeuRuntime.basename` (`core.ts:75`) is part of the
/// ported interface but the TypeScript core never calls it; kept for parity and
/// because host adapters implement it.
pub fn path_basename(path: &str) -> String {
    let characters: Vec<char> = path.chars().collect();
    let mut end = characters.len();
    while end > 0 && is_separator(characters[end - 1]) {
        end -= 1;
    }
    let mut cut: Option<usize> = None;
    let mut index = 0usize;
    while index < end {
        if is_separator(characters[index]) {
            cut = Some(index);
        }
        index += 1;
    }
    match cut {
        Some(cut) => characters[cut + 1..end].iter().collect(),
        None => characters[..end].iter().collect(),
    }
}

/// The stand-in for `localeCompare(b, undefined, { numeric: true,
/// sensitivity: "base" })` used by `core.ts:165` and `core.ts:215`.
///
/// Case-folded and digit-run aware, so `file-2.txt` sorts before `file-10.txt`
/// and `Root/A.txt` compares equal in weight to `root/a.txt`. Unlike ICU it does
/// not fold accents, and it breaks weight-equal pairs on the raw text so the
/// order is total: the TypeScript sort was stable over discovery order instead,
/// which is not reproducible once the host lists a directory in a different
/// order.
pub fn compare_paths_naturally(left: &str, right: &str) -> Ordering {
    let folded_left: Vec<char> = left.chars().flat_map(|c| c.to_lowercase()).collect();
    let folded_right: Vec<char> = right.chars().flat_map(|c| c.to_lowercase()).collect();

    let mut index_left = 0usize;
    let mut index_right = 0usize;
    while index_left < folded_left.len() && index_right < folded_right.len() {
        let character_left = folded_left[index_left];
        let character_right = folded_right[index_right];

        if character_left.is_ascii_digit() && character_right.is_ascii_digit() {
            let run_left = digit_run_end(&folded_left, index_left);
            let run_right = digit_run_end(&folded_right, index_right);
            match compare_digit_runs(&folded_left[index_left..run_left], &folded_right[index_right..run_right]) {
                Ordering::Equal => {
                    index_left = run_left;
                    index_right = run_right;
                    continue;
                }
                other => return other,
            }
        }

        match character_left.cmp(&character_right) {
            Ordering::Equal => {
                index_left += 1;
                index_right += 1;
            }
            other => return other,
        }
    }

    let remaining_left = folded_left.len() - index_left;
    let remaining_right = folded_right.len() - index_right;
    match remaining_left.cmp(&remaining_right) {
        Ordering::Equal => left.as_bytes().cmp(right.as_bytes()),
        other => other,
    }
}

fn digit_run_end(characters: &[char], start: usize) -> usize {
    let mut end = start;
    while end < characters.len() && characters[end].is_ascii_digit() {
        end += 1;
    }
    end
}

/// Numeric compare of two digit runs without parsing, so a run longer than
/// `u128` cannot silently saturate into the wrong order.
fn compare_digit_runs(left: &[char], right: &[char]) -> Ordering {
    let significant_left = strip_leading_zeros(left);
    let significant_right = strip_leading_zeros(right);
    significant_left
        .len()
        .cmp(&significant_right.len())
        .then_with(|| significant_left.cmp(significant_right))
}

fn strip_leading_zeros(digits: &[char]) -> &[char] {
    let mut start = 0usize;
    while start < digits.len() && digits[start] == '0' {
        start += 1;
    }
    &digits[start..]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_path_key_folds_case_and_backslashes() {
        // core.ts:255 exactly: backslash -> slash, then toLowerCase.
        assert_eq!(normalize_path_key(r"D:\Dir\A.TXT"), "d:/dir/a.txt");
        assert_eq!(normalize_path_key("/root/A.txt"), "/root/a.txt");
        assert_eq!(
            normalize_path_key("D:\\Mixed/Path.txt"),
            normalize_path_key("d:/mixed/path.txt")
        );
    }

    #[test]
    fn dirname_matches_the_shapes_the_node_produces() {
        let cases = [
            (r"D:\dir\file.txt", r"D:\dir"),
            (r"D:\file.txt", r"D:\"),
            ("/root/a.txt", "/root"),
            ("/a", "/"),
            ("a.txt", "."),
            ("", "."),
            (r"C:\dir\", r"C:\dir"),
        ];
        for (input, expected) in cases {
            assert_eq!(path_dirname(input), expected, "dirname({input})");
        }
    }

    #[test]
    fn join_keeps_separator_style_and_drops_dot_segments() {
        assert_eq!(path_join(&[r"D:\dir", "timeu-timestamps.json"]), r"D:\dir\timeu-timestamps.json");
        assert_eq!(path_join(&["/root", "x.json"]), "/root/x.json");
        assert_eq!(path_join(&[".", "x.json"]), "x.json");
        assert_eq!(path_join(&[]), ".");
        assert_eq!(path_join(&["", "x.json"]), "x.json");
        assert_eq!(path_join(&["/", "x.json"]), "/x.json");
        assert_eq!(path_join(&[r"C:", "x.json"]), r"C:\x.json");
    }

    #[test]
    fn basename_strips_trailing_separators() {
        assert_eq!(path_basename(r"D:\dir\file.txt"), "file.txt");
        assert_eq!(path_basename(r"D:\dir\"), "dir");
        assert_eq!(path_basename("file.txt"), "file.txt");
        assert_eq!(path_basename("/"), "");
    }

    #[test]
    fn natural_order_is_numeric_and_case_insensitive() {
        let mut paths = vec![
            "/root/file-10.txt",
            "/Root/file-2.txt",
            "/root/file.txt",
        ];
        paths.sort_by(|left, right| compare_paths_naturally(left, right));
        assert_eq!(
            paths,
            vec!["/Root/file-2.txt", "/root/file-10.txt", "/root/file.txt"],
            "digit runs compare as numbers, and case folding keeps file-2 first"
        );

        assert_eq!(
            compare_paths_naturally("a01.txt", "a1.txt"),
            Ordering::Less,
            "weight-equal numbers break on the raw text so the order stays total"
        );
    }
}
