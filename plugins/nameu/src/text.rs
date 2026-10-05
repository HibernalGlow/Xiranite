//! Text primitives that must follow JavaScript semantics, not Rust defaults.
//!
//! The TypeScript source leans on `String.prototype.trim`, `\s`, `toLowerCase`
//! and UTF-16 `length`/`slice`; a plain Rust `trim`/`len` silently differs.

/// JS `\s` and `String.trim` match WhiteSpace ∪ LineTerminator: Unicode `Zs`
/// plus U+2028/U+2029 and U+FEFF, and they exclude U+0085, which Rust's
/// `char::is_whitespace` (Unicode `White_Space`) includes.
pub(crate) fn is_js_whitespace(ch: char) -> bool {
    match ch {
        '\u{feff}' => true,
        '\u{85}' => false,
        other => other.is_whitespace(),
    }
}

pub(crate) fn js_trim(value: &str) -> &str {
    value.trim_matches(is_js_whitespace)
}

pub(crate) fn js_trim_end(value: &str) -> &str {
    value.trim_end_matches(is_js_whitespace)
}

pub(crate) fn remove_js_whitespace(value: &str) -> String {
    value.chars().filter(|ch| !is_js_whitespace(*ch)).collect()
}

pub(crate) fn collapse_whitespace_runs(value: &[char], replacement: char) -> Vec<char> {
    let mut out: Vec<char> = Vec::with_capacity(value.len());
    let mut index = 0;
    while index < value.len() {
        if is_js_whitespace(value[index]) {
            let mut end = index;
            while end < value.len() && is_js_whitespace(value[end]) {
                end += 1;
            }
            // JS `/\s{2,}/g` only rewrites runs of two or more; a single
            // whitespace character is copied through unchanged.
            if end - index >= 2 {
                out.push(replacement);
            } else {
                out.push(value[index]);
            }
            index = end;
        } else {
            out.push(value[index]);
            index += 1;
        }
    }
    out
}

/// UTF-16 code units, which is what `String.prototype.length` counts.
pub(crate) fn utf16_length(value: &str) -> usize {
    value.chars().map(|ch| if (ch as u32) > 0xFFFF { 2 } else { 1 }).sum()
}

/// JS `value.slice(0, max_units)`. Rust cannot represent the lone surrogate a
/// code-unit slice may leave behind, so a pair straddling the limit is dropped
/// whole instead of being split.
pub(crate) fn truncate_to_utf16_length(value: &str, max_units: usize) -> String {
    let mut out = String::with_capacity(value.len());
    let mut used = 0_usize;
    for ch in value.chars() {
        let width = if (ch as u32) > 0xFFFF { 2 } else { 1 };
        if used + width > max_units {
            break;
        }
        used += width;
        out.push(ch);
    }
    out
}

/// JS `String.prototype.toLowerCase` for comparison keys.
pub(crate) fn lower_key(value: &str) -> String {
    value.chars().flat_map(|ch| ch.to_lowercase()).collect()
}

pub(crate) fn lower_key_from_chars(value: &[char]) -> String {
    value.iter().flat_map(|ch| ch.to_lowercase()).collect()
}

/// JS `String(value ?? "").trim()`.
pub(crate) fn clean(value: Option<&str>) -> String {
    js_trim(value.unwrap_or_default()).to_string()
}

/// JS `String(value ?? "").split(/\r?\n|,/).map(trim).filter(Boolean)`.
pub(crate) fn parse_list(value: Option<&str>) -> Vec<String> {
    let mut out = Vec::new();
    for part in value.unwrap_or_default().split(['\n', ',']) {
        let trimmed = js_trim(part.strip_prefix('\r').unwrap_or(part));
        if !trimmed.is_empty() {
            out.push(trimmed.to_string());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_whitespace_set_differs_from_rust() {
        assert!(is_js_whitespace('\u{feff}'));
        assert!(!is_js_whitespace('\u{85}'));
        assert!(is_js_whitespace('\u{3000}'));
    }

    #[test]
    fn parse_list_splits_on_newlines_and_commas() {
        assert_eq!(
            parse_list(Some("a,\r\nb\n, c ,,d")),
            vec!["a".to_string(), "b".to_string(), "c".to_string(), "d".to_string()]
        );
        assert_eq!(parse_list(None), Vec::<String>::new());
    }

    #[test]
    fn utf16_truncation_counts_code_units() {
        // One astral character costs two UTF-16 units, so it does not fit in a
        // three-unit budget that is already carrying two units.
        assert_eq!(truncate_to_utf16_length("ab😀", 3), "ab");
        assert_eq!(utf16_length("ab😀"), 4);
        assert_eq!(truncate_to_utf16_length("abc", 80), "abc");
    }

    #[test]
    fn collapse_whitespace_only_replaces_runs() {
        let chars: Vec<char> = "a b  c   d".chars().collect();
        let collapsed: String = collapse_whitespace_runs(&chars, ' ').into_iter().collect();
        assert_eq!(collapsed, "a b c d");
    }
}
