//! Two separator rules, spelled out instead of pulled in as a regex dependency.
//!
//! The node splits user text in two places and the two rules are **not** the same one, so a shared "split on
//! everything" helper would silently change what a path may contain:
//!
//! - `packages/nodes/classq/src/core.ts:238` uses `/\r?\n|,/` for `listText`.
//! - `packages/nodes/classq/src/interaction.ts:31` uses `/[\r\n,;]+/` for the `paths` field, which is the published
//!   definition's `Transform::Delimited` (`node-definitions/classq.json`, `inputBindings` for `paths`).
//!
//! A lone `\r` is therefore *content* for the first rule and a separator for the second, exactly as the JavaScript
//! patterns behave. Blank pieces are kept here and dropped by the callers, so both rules can be tested on their
//! splitting alone.

/// Splits on `\r\n`, `\n` or `,` (`core.ts:238`). A `\r` that does not precede a `\n` stays inside the piece.
#[must_use]
pub fn split_newline_or_comma(text: &str) -> Vec<&str> {
    let mut pieces: Vec<&str> = Vec::new();
    let mut start = 0usize;
    let bytes = text.as_bytes();
    let mut index = 0usize;
    while index < bytes.len() {
        match bytes[index] {
            b',' => {
                pieces.push(&text[start..index]);
                index += 1;
                start = index;
            }
            b'\n' => {
                // `\r\n` consumed as one separator: back the piece start up over the `\r`.
                let cut = if index > start && bytes[index - 1] == b'\r' { index - 1 } else { index };
                pieces.push(&text[start..cut]);
                index += 1;
                start = index;
            }
            _ => index += 1,
        }
    }
    pieces.push(&text[start..]);
    pieces
}

/// Splits on any run of `\r`, `\n`, `,` or `;` (`interaction.ts:31`).
#[must_use]
pub fn split_newline_comma_semicolon(text: &str) -> Vec<&str> {
    let mut pieces: Vec<&str> = Vec::new();
    let mut start = 0usize;
    let mut in_run = false;
    for (index, character) in text.char_indices() {
        if matches!(character, '\r' | '\n' | ',' | ';') {
            if !in_run {
                pieces.push(&text[start..index]);
                in_run = true;
            }
            start = index + character.len_utf8();
        } else if in_run {
            in_run = false;
        }
    }
    if !in_run {
        pieces.push(&text[start..]);
    }
    pieces
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_core_rule_treats_a_bare_carriage_return_as_content() {
        assert_eq!(split_newline_or_comma("a\r\nb,c"), vec!["a", "b", "c"]);
        assert_eq!(split_newline_or_comma("a\rb"), vec!["a\rb"]);
        assert_eq!(split_newline_or_comma("a;b"), vec!["a;b"], "no semicolon rule here");
    }

    #[test]
    fn the_field_rule_collapses_a_run_of_separators() {
        assert_eq!(split_newline_comma_semicolon("a\r\n,,;b"), vec!["a", "b"]);
        assert_eq!(split_newline_comma_semicolon("a\rb"), vec!["a", "b"]);
        assert_eq!(split_newline_comma_semicolon(""), vec![""], "one empty piece, then the caller drops it");
    }

    #[test]
    fn both_rules_end_with_the_trailing_piece() {
        assert_eq!(split_newline_or_comma("a,"), vec!["a", ""]);
        assert_eq!(split_newline_comma_semicolon("a;"), vec!["a"]);
    }
}
