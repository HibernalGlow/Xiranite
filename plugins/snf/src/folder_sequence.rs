//! Numbered folder-name grammar, sequence continuity and keyword priority.
//!
//! These three helpers decide the whole ordering of an SNF plan, so they are
//! ported as exact mirrors of `parseNumberedFolder`, `isContinuous` and
//! `priority` in `packages/nodes/snf/src/core.ts` rather than as a Rust "better"
//! version.

use crate::javascript_text::{is_javascript_whitespace, lower_case_like_javascript, trim_javascript_whitespace};

/// The `{ number, name }` pair `core.ts:173` returns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NumberedFolderName {
    /// The leading number, used for the continuity check and as the sort
    /// tie-breaker. `sequence` in the emitted plan item.
    pub sequence_number: u64,
    /// The rest of the folder name after the separator run, itself trimmed:
    /// this is the label re-used verbatim in `"<index>. <label>"`.
    pub folder_label: String,
}

/// `parseNumberedFolder` at `core.ts:173-177`, i.e. `/^(\d+)[.\s-]+(.+)$/` on
/// `name.trim()`, without a regular-expression dependency.
///
/// The pieces that make it a mirror and not an approximation:
///
/// - `\d` is ASCII-only. Without the `u` flag ECMAScript `\d` is `[0-9]`, so
///   `３. CG` (full-width) and `٣. CG` (Arabic-Indic) are *not* numbered folders
///   even though `char::is_numeric` would accept them;
/// - `[.\s-]+` is greedy and `(.+)` cannot match a line terminator while `$`
///   anchors at the very end of the input, so any `\n`, `\r`, `U+2028` or `U+2029`
///   left in the tail rejects the whole name;
/// - because `+` is greedy, `(.+)` backtracks minimally: `"3.."` yields the label
///   `"."` instead of rejecting, which only shows up if the separator run is
///   given back one character;
/// - the ECMAScript `\s` class is `char::is_whitespace` plus `U+FEFF`, and
///   `String.prototype.trim` uses the same set (see `crate::javascript_text`).
#[must_use]
pub fn parse_numbered_folder_name(name: &str) -> Option<NumberedFolderName> {
    let trimmed = trim_javascript_whitespace(name);

    let digits_end = trimmed
        .char_indices()
        .find(|(_, character)| !character.is_ascii_digit())
        .map_or(trimmed.len(), |(index, _)| index);
    if digits_end == 0 {
        return None;
    }

    let separator_run = &trimmed[digits_end..];
    let run_length = separator_run
        .char_indices()
        .rfind(|(_, character)| is_folder_separator_character(*character))
        .map_or(0, |(index, character)| index + character.len_utf8());
    if run_length == 0 {
        return None;
    }

    let remainder = &separator_run[run_length..];
    let label = if remainder.is_empty() {
        // Greedy `+` gives its last character back so `(.+)` has something to
        // match; a one-character run then leaves nothing and the name is rejected.
        let run = &separator_run[..run_length];
        match run.chars().next_back() {
            Some(last_separator) if run.chars().count() >= 2 => last_separator.to_string(),
            _ => return None,
        }
    } else {
        if remainder.contains(['\n', '\r', '\u{2028}', '\u{2029}']) {
            return None;
        }
        remainder.to_string()
    };

    Some(NumberedFolderName {
        sequence_number: parse_sequence_number(&trimmed[..digits_end]),
        folder_label: trim_javascript_whitespace(&label).to_string(),
    })
}

const fn is_folder_separator_character(character: char) -> bool {
    matches!(character, '.' | '-') || is_javascript_whitespace(character)
}

/// `Number(match[1])`. ECMAScript gives an IEEE-754 double, so a digit run past
/// 2^53 loses precision; the port saturates at `u64::MAX` instead, which keeps
/// ordering sane for the (pathological) 20-digit folder name and can never
/// overflow. Leading zeros collapse exactly as `Number("0012")` does.
fn parse_sequence_number(digits: &str) -> u64 {
    digits.bytes().fold(0u64, |value, byte| {
        value.saturating_mul(10).saturating_add(u64::from(byte - b'0'))
    })
}

/// `isContinuous` at `core.ts:179-181`: continuous means it starts at 1 and every
/// next value is the previous plus one, so a duplicated number breaks it.
#[must_use]
pub fn is_continuous_sequence(sorted_numbers: &[u64]) -> bool {
    sorted_numbers.first() == Some(&1)
        && sorted_numbers
            .windows(2)
            .all(|pair| pair[1] == pair[0].saturating_add(1))
}

/// `priority` at `core.ts:183-187`: the index of the first keyword contained in
/// the label, or the keyword-count sentinel for "no match" (which sorts last).
///
/// An empty keyword is kept rather than filtered: `String.prototype.includes("")`
/// is `true`, so a blank keyword makes every folder match rank 0, and that is what
/// `core.ts` does with `priorityKeywords: [""]`.
#[must_use]
pub fn priority_keyword_rank(folder_label: &str, priority_keywords: &[String]) -> usize {
    let lowered_label = lower_case_like_javascript(folder_label);
    priority_keywords
        .iter()
        .position(|keyword| lowered_label.contains(&lower_case_like_javascript(keyword)))
        .unwrap_or(priority_keywords.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(name: &str) -> Option<(u64, String)> {
        parse_numbered_folder_name(name).map(|value| (value.sequence_number, value.folder_label))
    }

    #[test]
    fn parses_the_cases_the_vitest_spec_has() {
        assert_eq!(parsed("3. CG"), Some((3, "CG".to_string())));
        assert_eq!(parsed("Folder"), None);
    }

    #[test]
    fn accepts_the_separator_classes_and_leading_zeros() {
        assert_eq!(parsed("1. 同人志"), Some((1, "同人志".to_string())));
        assert_eq!(parsed("12-CG"), Some((12, "CG".to_string())));
        assert_eq!(parsed("12.CG"), Some((12, "CG".to_string())));
        assert_eq!(parsed("0012. CG"), Some((12, "CG".to_string())));
        assert_eq!(parsed("  7.  Art Book  "), Some((7, "Art Book".to_string())));
    }

    #[test]
    fn rejects_names_the_javascript_regex_rejects() {
        assert_eq!(parsed("3."), None, "separator run of one, nothing for (.+)");
        assert_eq!(parsed("3.."), Some((3, ".".to_string())), "greedy backtracking");
        assert_eq!(parsed("34"), None, "no separator");
        assert_eq!(parsed("3. a\nb"), None, "dot cannot cross a line terminator");
        assert_eq!(parsed("3. a\r\nb"), None);
        assert_eq!(parsed("３. CG"), None, "full-width digit is not \\d");
        assert_eq!(parsed("٣. CG"), None, "Arabic-Indic digit is not \\d");
    }

    #[test]
    fn sequence_numbers_saturate_instead_of_overflowing() {
        assert_eq!(parsed("99999999999999999999999. CG").map(|value| value.0), Some(u64::MAX));
        assert_eq!(parsed("18446744073709551615. CG").map(|value| value.0), Some(u64::MAX));
    }

    #[test]
    fn continuity_needs_a_one_and_no_gaps_or_duplicates() {
        assert!(is_continuous_sequence(&[1]));
        assert!(is_continuous_sequence(&[1, 2, 3]));
        assert!(!is_continuous_sequence(&[2, 3]));
        assert!(!is_continuous_sequence(&[1, 1, 2]));
        assert!(!is_continuous_sequence(&[1, 3]));
        assert!(!is_continuous_sequence(&[]));
    }

    #[test]
    fn priority_ranks_labels_by_first_keyword_hit() {
        let keywords: Vec<String> = crate::contract::DEFAULT_PRIORITY_KEYWORDS
            .iter()
            .map(|keyword| (*keyword).to_string())
            .collect();
        assert_eq!(priority_keyword_rank("同人志 C88", &keywords), 0);
        assert_eq!(priority_keyword_rank("CG set", &keywords), 3);
        assert_eq!(priority_keyword_rank("cg set", &keywords), 3, "case-insensitive");
        assert_eq!(priority_keyword_rank("Sketches", &keywords), keywords.len());
        assert_eq!(priority_keyword_rank("Anything", &["".to_string()]), 0, "empty keyword matches");
    }
}
