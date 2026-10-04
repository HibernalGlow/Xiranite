//! JavaScript-faithful text primitives, ported from `packages/nodes/linedup/src/core.ts:15-25`.
//!
//! Every function here is a *port*, not a reimplementation: the node's observable behaviour is the
//! TypeScript's, so the edge cases below are the ones the existing vitest cases and CLI cases rely
//! on. `AGENTS.md` forbids letting a port drift silently, and a line filter drifts on exactly three
//! things — what counts as whitespace, how lines split, and which blank lines survive.

/// The characters ECMAScript's `String.prototype.trim()` removes: the `WhiteSpace` production plus
/// the `LineTerminator` production.
///
/// This is deliberately *not* [`char::is_whitespace`], which is the Unicode `White_Space` property
/// and differs from ECMAScript in two places that a pasted list can actually hit:
///
/// * U+FEFF (ZERO WIDTH NO-BREAK SPACE / BOM) — ECMAScript trims it, Rust does not, and a
///   UTF-8-with-BOM `source.txt` starts its first line with it. `core.ts:16` trims it away.
/// * U+0085 (NEXT LINE) — Unicode says `White_Space`, ECMAScript does not list it, so the node keeps
///   it inside a token. Trimming it here would silently merge two distinct filter tokens.
const fn is_js_trimmable(ch: char) -> bool {
    matches!(ch as u32,
        0x0009..=0x000D // TAB, LF, VT, FF, CR
        | 0x0020        // SPACE
        | 0x00A0        // NO-BREAK SPACE
        | 0x1680        // OGHAM SPACE MARK
        | 0x2000..=0x200A
        | 0x2028 | 0x2029 // LINE / PARAGRAPH SEPARATOR
        | 0x202F | 0x205F | 0x3000
        | 0xFEFF // ZWNBSP, trimmed by ECMAScript and by `char::is_whitespace` not at all
    )
}

/// `core.ts:16` `line.trim()`.
#[must_use]
pub fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_trimmable)
}

/// `core.ts:15` `normalizeLine`.
#[must_use]
pub fn normalize_line(line: &str) -> &str {
    js_trim(line)
}

/// `core.ts:23-25` `splitLines`: `\r\n` becomes `\n`, then a lone `\r` becomes `\n`, then split on
/// `\n`.
///
/// Two consequences the node depends on and that a `lines()`-based port would get wrong:
/// a trailing newline yields a final empty element (`splitLines("a\n") == ["a", ""]`, which is why
/// `interaction.ts`'s preview counts one more line than there are tokens), and U+2028/U+2029 are
/// *not* line separators even though `trim` treats them as whitespace.
#[must_use]
pub fn split_lines(text: &str) -> Vec<String> {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(str::to_owned)
        .collect()
}

/// `core.ts:19-21` `uniqueNonEmptyLines`: trim each, drop the empty ones, keep first-seen order.
///
/// The dedupe happens *before* filtering (`core.ts:28-29`), so a source list with the same line
/// twice contributes one kept line and one removal record at most — the counts in
/// [`crate::filter_core::FilterOutcome`] are counts of unique lines, not of input lines.
#[must_use]
pub fn unique_non_empty_lines(lines: &[String]) -> Vec<String> {
    let mut seen: Vec<String> = Vec::with_capacity(lines.len());
    for line in lines {
        let normalized = normalize_line(line);
        if normalized.is_empty() || seen.iter().any(|kept| kept == normalized) {
            continue;
        }
        seen.push(normalized.to_owned());
    }
    seen
}

/// `cli.ts:457` `(inline ?? "").replace(/\\n/g, "\n")`, and the same call for both guided text
/// fields at `cli.ts:308-309`.
///
/// Only the CLI's inline flags and the guided prompts spell a newline as two characters; a GUI card
/// or an operation request carries real line breaks. The flag therefore lives in the request
/// ([`LinedupInput::unescape_literal_newlines`](crate::contract::LinedupInput)) and defaults to false,
/// because running this over GUI text would turn a literal `\n` inside a Windows path token into two
/// lines.
#[must_use]
pub fn unescape_literal_newlines(text: &str) -> String {
    text.replace("\\n", "\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_trim_removes_the_bom_and_keeps_next_line() {
        assert_eq!(js_trim("\u{FEFF}alpha\u{FEFF}"), "alpha");
        assert_eq!(js_trim("  alpha\t"), "alpha");
        assert_eq!(js_trim("\u{2028}alpha\u{2029}"), "alpha");
        assert_eq!(js_trim("\u{85}alpha\u{85}"), "\u{85}alpha\u{85}");
        assert_eq!(js_trim("a\u{A0}"), "a");
    }

    #[test]
    fn split_lines_normalizes_both_line_ending_families() {
        assert_eq!(split_lines("a\r\nb\rc\nd"), ["a", "b", "c", "d"]);
        assert_eq!(split_lines("keep\nremove"), ["keep", "remove"]);
    }

    #[test]
    fn a_trailing_newline_yields_one_extra_empty_line() {
        // `interaction.ts`'s preview counts this value, so the off-by-one is the contract.
        assert_eq!(split_lines("a\n").len(), 2);
        assert_eq!(split_lines("").len(), 1);
        assert_eq!(split_lines(""), [""]);
    }

    #[test]
    fn unique_non_empty_lines_trims_then_dedupes_in_first_seen_order() {
        // core.test.ts:13-15
        assert_eq!(unique_non_empty_lines(&[" a ".into(), "".into(), "a".into(), "b".into()]), ["a", "b"]);
    }

    #[test]
    fn unescape_literal_newlines_only_touches_the_two_character_escape() {
        assert_eq!(unescape_literal_newlines("a\\nb"), "a\nb");
        // Every occurrence, as `/\\n/g` does — including the one that is really a Windows path
        // separator followed by `n`. That is the hazard behind `LinedupInput::unescape_literal_newlines`
        // defaulting to false: the flag belongs to the CLI's inline arguments, never to GUI text.
        assert_eq!(unescape_literal_newlines("C:\\note\\nx"), "C:\note\nx");
        assert_eq!(unescape_literal_newlines("a\nb"), "a\nb", "a real newline is already a newline");
    }
}
