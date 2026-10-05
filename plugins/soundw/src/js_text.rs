//! The JavaScript text semantics this port has to reproduce exactly.
//!
//! `core.ts` and `interaction.ts` trim, split and join with ECMAScript rules, and those rules
//! reach the user: `SoundwData.output` is a trimmed join (`core.ts:22`), `muteState` is a trimmed
//! stdout or `null` (`core.ts:32`), and profile names come out of a table split on `│`
//! (`core.ts:34-40`). Rust's `str::trim`/`str::split` differ from them in ways that matter for
//! Windows console output, so the differences are named here instead of being absorbed silently.
//!
//! ADR-0068 keeps this module free of boundary types beyond `&str`/`String`/`Vec<&str>`, all of
//! which a WIT signature expresses directly.

/// Characters JavaScript's `String.prototype.trim()` removes that Rust's
/// `char::is_whitespace` does not: U+FEFF is `<ZWNBSP>` in the ECMAScript `WhiteSpace` production
/// but left the Unicode `White_Space` property, and Windows tooling emits a BOM on real output.
const JS_EXTRA_TRIM_CHARS: [char; 1] = ['\u{FEFF}'];

/// `String.prototype.trim()` as ECMAScript defines it: the `WhiteSpace` set (which includes
/// U+000B, U+000C, U+FEFF and the NBSP family) plus the `LineTerminator` set (LF, CR, U+2028,
/// U+2029).
///
/// Rust's `char::is_whitespace` covers every one of those except U+FEFF, so this is
/// `str::trim()` with that one character added rather than a new table.
#[must_use]
pub fn js_trim(value: &str) -> &str {
    value.trim_matches(|character: char| character.is_whitespace() || JS_EXTRA_TRIM_CHARS.contains(&character))
}

/// `String.prototype.split(/\r?\n/)`: breaks on LF and on CRLF, never on a lone CR.
///
/// `str::lines()` would also strip a trailing CR and would treat the input's final newline as no
/// separator at all, which is the same result here, but it drops the distinction `core.ts:35`
/// needs between `""` and `[""]` for an empty string. Both are `[""]` in JavaScript; keep it.
#[must_use]
pub fn js_split_lines(value: &str) -> Vec<&str> {
    let mut lines: Vec<&str> = Vec::new();
    let mut start = 0usize;
    let bytes = value.as_bytes();
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == b'\n' {
            let line_end = if index > start && bytes[index - 1] == b'\r' { index - 1 } else { index };
            lines.push(&value[start..line_end]);
            start = index + 1;
        }
        index += 1;
    }
    lines.push(&value[start..]);
    lines
}

/// `[stdout, stderr].filter(Boolean).join("\n")` from `core.ts:22`.
///
/// `filter(Boolean)` drops the *empty* strings, so `"a"` + `""` is `"a"` and not `"a\n"`; the
/// trailing `.trim()` then removes whatever whitespace the kept text opens and closes with.
#[must_use]
pub fn js_join_streams(stdout: &str, stderr: &str) -> String {
    let kept: Vec<&str> = [stdout, stderr].into_iter().filter(|part| !part.is_empty()).collect();
    js_trim(&kept.join("\n")).to_owned()
}

/// `String(value).trim()` from `interaction.ts:24`, for a field that may be absent.
#[must_use]
pub fn js_trim_option(value: Option<&str>) -> String {
    js_trim(value.unwrap_or_default()).to_owned()
}

/// `text.trim() || undefined` (`interaction.ts:24`) and `text.trim() || null` (`core.ts:32`): one
/// rule, two wire spellings, so it returns `Option` and the caller decides.
#[must_use]
pub fn trimmed_or_none(value: &str) -> Option<String> {
    let trimmed = js_trim(value);
    if trimmed.is_empty() { None } else { Some(trimmed.to_owned()) }
}

/// `x.split("│")` from `core.ts:37`: a single-character separator split, keeping every cell
/// including the empty ones the leading and trailing border produces.
#[must_use]
pub fn split_on_box_drawing(value: &str) -> Vec<&str> {
    value.split('│').collect()
}

/// `/operation has timed out|did not respond within/i` from `core.ts:24`, as the two alternatives
/// it is: case-insensitive substring tests, no anchors, no metacharacters.
#[must_use]
pub fn matches_timeout_pattern(value: &str) -> bool {
    let lowered = value.to_lowercase();
    lowered.contains("operation has timed out") || lowered.contains("did not respond within")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trim_removes_the_whitespace_javascript_removes() {
        assert_eq!(js_trim("  \u{FEFF}Muted \r\n"), "Muted");
        assert_eq!(js_trim("\u{000b}\u{000c}x\u{00a0}"), "x");
        assert_eq!(js_trim("\u{2028}y\u{2029}"), "y");
        assert_eq!(js_trim(""), "");
        // Negative control: interior whitespace and other control characters survive.
        assert_eq!(js_trim(" a\tb "), "a\tb");
        assert_eq!(js_trim("\u{0001}x"), "\u{0001}x");
    }

    #[test]
    fn line_splitting_follows_the_regular_expression() {
        assert_eq!(js_split_lines("a\r\nb\nc"), vec!["a", "b", "c"]);
        assert_eq!(js_split_lines(""), vec![""]);
        assert_eq!(js_split_lines("a\n"), vec!["a", ""]);
        // A lone CR is not a line break for `/\r?\n/`, and must not become one here.
        assert_eq!(js_split_lines("a\rb"), vec!["a\rb"]);
    }

    #[test]
    fn stream_joining_drops_empty_parts_before_trimming() {
        assert_eq!(js_join_streams("ok", ""), "ok");
        assert_eq!(js_join_streams("", "boom"), "boom");
        // Checked against `["line1\n", "\nline2  "].filter(Boolean).join("\n").trim()` in node:
        // the separator the join adds is kept *and* the two newlines the streams carried, so three.
        assert_eq!(js_join_streams("line1\n", "\nline2  "), "line1\n\n\nline2");
        assert_eq!(js_join_streams("", ""), "");
        // Negative control: a whitespace-only stream is kept by `filter(Boolean)` and then trimmed
        // away, which is why `" "` + `""` is `""` rather than `" "`.
        assert_eq!(js_join_streams(" ", ""), "");
    }

    #[test]
    fn trimmed_or_none_treats_blank_as_absent() {
        assert_eq!(trimmed_or_none("  womic "), Some("womic".to_owned()));
        assert_eq!(trimmed_or_none("   "), None);
        assert_eq!(trimmed_or_none("\u{FEFF}"), None);
    }

    #[test]
    fn box_drawing_split_keeps_the_border_cells() {
        assert_eq!(split_on_box_drawing("│ womic │ Not set  │"), vec!["", " womic ", " Not set  ", ""]);
        assert_eq!(split_on_box_drawing("no border"), vec!["no border"]);
    }

    #[test]
    fn the_timeout_pattern_is_case_insensitive_and_unanchored() {
        assert!(matches_timeout_pattern("Error: The operation has timed out."));
        assert!(matches_timeout_pattern("SoundSwitch CLI did not respond within 15 seconds."));
        assert!(matches_timeout_pattern("DID NOT RESPOND WITHIN 2 seconds"));
        // Negative controls: a plain failure must not be rewritten into the background-app advice.
        assert!(!matches_timeout_pattern("Access is denied."));
        assert!(!matches_timeout_pattern("timed"));
    }
}
