//! Name rules ported from `cleanupName`, `normalizeArchiveName`,
//! `normalizeFolderName` and their helpers in `packages/nodes/nameu/src/core.ts`.
//!
//! The TypeScript applies fourteen regular expressions in a fixed order. Rust has
//! no regex here, so each pattern is a named scan over `Vec<char>`; the order
//! below is the order of the `replacements` array (core.ts:240-255) and changing
//! it changes output.

use std::collections::HashSet;

use unicode_normalization::UnicodeNormalization;
use unicode_script::{Script, UnicodeScript};

use crate::contract::NameuNameRules;
use crate::text::{
    collapse_whitespace_runs, is_js_whitespace, js_trim, js_trim_end, lower_key,
    lower_key_from_chars, remove_js_whitespace, truncate_to_utf16_length, utf16_length,
};

/// `truncateSmart(next, 80)` (core.ts:231, 300-303) counts UTF-16 code units.
const SMART_TRUNCATE_LIMIT_UTF16_UNITS: usize = 80;

/// Bracket characters the TypeScript normalizes to ASCII before matching
/// (core.ts:241-245). NFKC already folds the fullwidth forms; 【 and 】 do not
/// normalize and still need this map.
fn fold_full_width_brackets(value: &mut Vec<char>) {
    for ch in value.iter_mut() {
        *ch = match *ch {
            '【' | '［' => '[',
            '】' | '］' => ']',
            '（' => '(',
            '）' => ')',
            '｛' => '{',
            '｝' => '}',
            other => other,
        };
    }
}

/// What a delimited-block scanner should do with a candidate block.
pub(crate) enum BlockReplacement {
    /// The candidate is not a match; keep the opening character and let the
    /// scan resume at the next character, like a failed JS regex step.
    NotMatched,
    /// The characters that replace the whole matched span, brackets included.
    With(Vec<char>),
}

/// Mirrors a JS `/open…close/g` replacement pass: for each `open`, the block
/// ends at the first `close` that appears before the next `open`; a nested
/// `open` makes the outer candidate fail and the scan retries one character
/// later, so `" {a {b}"` yields `" {a "`. Blocks whose content is shorter than
/// `min_content_chars` are not matches.
fn replace_delimited_blocks<F>(
    value: &[char],
    open: char,
    close: char,
    min_content_chars: usize,
    decide: &mut F,
) -> Vec<char>
where
    F: FnMut(&[char]) -> BlockReplacement,
{
    let mut out: Vec<char> = Vec::with_capacity(value.len());
    let mut index = 0;
    while index < value.len() {
        if value[index] != open {
            out.push(value[index]);
            index += 1;
            continue;
        }
        let mut end = index + 1;
        while end < value.len() && value[end] != open && value[end] != close {
            end += 1;
        }
        let closes_block = end < value.len() && value[end] == close;
        if closes_block && end - index - 1 >= min_content_chars {
            if let BlockReplacement::With(replacement) = decide(&value[index + 1..end]) {
                out.extend(replacement);
                index = end + 1;
                continue;
            }
        }
        out.push(open);
        index += 1;
    }
    out
}

fn with_block(open: char, content: &[char], close: char) -> BlockReplacement {
    let mut out = Vec::with_capacity(content.len() + 2);
    out.push(open);
    out.extend_from_slice(content);
    out.push(close);
    BlockReplacement::With(out)
}

/// `/\{(?:\d+(?:\.\d+)?[kKwW]?@(?:PX|WD)|\d+%?@DE|\d+(?:w|p|px|de))\}/gi`
/// (core.ts:247).
fn remove_resolution_tag_brace_blocks(value: &[char]) -> Vec<char> {
    replace_delimited_blocks(value, '{', '}', 1, &mut |content| {
        if is_resolution_tag(&lower_key_from_chars(content)) {
            BlockReplacement::With(Vec::new())
        } else {
            BlockReplacement::NotMatched
        }
    })
}

/// `/\[(?:cbr|multi|trash|multi-main)\]/gi` and `/\[samename_\d+\]/gi`
/// (core.ts:248-249).
fn remove_noise_tag_bracket_blocks(value: &[char]) -> Vec<char> {
    const NOISE_TAGS: [&str; 4] = ["cbr", "multi", "trash", "multi-main"];
    replace_delimited_blocks(value, '[', ']', 1, &mut |content| {
        let key = lower_key_from_chars(content);
        let is_samename_tag = key
            .strip_prefix("samename_")
            .is_some_and(|digits| !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit()));
        if NOISE_TAGS.contains(&key.as_str()) || is_samename_tag {
            BlockReplacement::With(Vec::new())
        } else {
            BlockReplacement::NotMatched
        }
    })
}

/// `/\s\(\d+\)$/g` (core.ts:250): one run of digits in parentheses, anchored at
/// the end and preceded by whitespace.
fn remove_trailing_copy_counter(value: &[char]) -> Vec<char> {
    if value.last() != Some(&')') {
        return value.to_vec();
    }
    let mut cursor = value.len() - 1;
    let mut digits = 0;
    while cursor > 0 && value[cursor - 1].is_ascii_digit() {
        cursor -= 1;
        digits += 1;
    }
    if digits == 0 || cursor < 2 || value[cursor - 1] != '(' || !is_js_whitespace(value[cursor - 2]) {
        return value.to_vec();
    }
    value[..cursor - 2].to_vec()
}

/// `/\{\s*[^{}]*\s*\}/g` (core.ts:251): with the two `\s*` allowed to match
/// empty, this deletes every brace block that contains no nested brace.
fn remove_flat_brace_blocks(value: &[char]) -> Vec<char> {
    replace_delimited_blocks(value, '{', '}', 0, &mut |_| BlockReplacement::With(Vec::new()))
}

/// `/\(\s*\)\s*/g` and `/\[\s*\]\s*/g` (core.ts:252-253), both replaced by a
/// single space and both swallowing the whitespace that follows.
fn collapse_empty_delimiter_blocks(value: &[char], open: char, close: char) -> Vec<char> {
    let mut out: Vec<char> = Vec::with_capacity(value.len());
    let mut index = 0;
    while index < value.len() {
        if value[index] != open {
            out.push(value[index]);
            index += 1;
            continue;
        }
        let mut cursor = index + 1;
        while cursor < value.len() && is_js_whitespace(value[cursor]) {
            cursor += 1;
        }
        if value.get(cursor) != Some(&close) {
            out.push(open);
            index += 1;
            continue;
        }
        cursor += 1;
        while cursor < value.len() && is_js_whitespace(value[cursor]) {
            cursor += 1;
        }
        out.push(' ');
        index = cursor;
    }
    out
}

/// `removeDuplicateBracketContent` (core.ts:262-270): the first `[x]` block wins
/// and every later block whose whitespace-stripped lowercase content repeats it
/// is deleted together with its brackets.
fn remove_duplicate_bracket_content(value: &[char]) -> Vec<char> {
    let mut seen: HashSet<String> = HashSet::new();
    replace_delimited_blocks(value, '[', ']', 1, &mut |content| {
        let key = remove_js_whitespace(&lower_key_from_chars(content));
        if seen.contains(&key) {
            BlockReplacement::With(Vec::new())
        } else {
            seen.insert(key);
            with_block('[', content, ']')
        }
    })
}

fn replace_literal(value: &[char], needle: &str, replacement: &str) -> Vec<char> {
    replace_literal_inner(value, needle, replacement, false)
}

fn replace_literal_case_insensitive(value: &[char], needle: &str, replacement: &str) -> Vec<char> {
    replace_literal_inner(value, needle, replacement, true)
}

fn replace_literal_inner(value: &[char], needle: &str, replacement: &str, case_insensitive: bool) -> Vec<char> {
    let needle_chars: Vec<char> = needle.chars().collect();
    let needle_key = lower_key(needle);
    if needle_chars.is_empty() {
        return value.to_vec();
    }
    let mut out: Vec<char> = Vec::with_capacity(value.len());
    let mut index = 0;
    while index + needle_chars.len() <= value.len() {
        let candidate = &value[index..index + needle_chars.len()];
        let matched = if case_insensitive {
            lower_key_from_chars(candidate) == needle_key
        } else {
            candidate == needle_chars.as_slice()
        };
        if matched {
            out.extend(replacement.chars());
            index += needle_chars.len();
        } else {
            out.push(value[index]);
            index += 1;
        }
    }
    out.extend_from_slice(&value[index..]);
    out
}

/// `spaceText` (core.ts:272-277): two single passes that push Han and ASCII
/// letters/digits apart, then one whitespace collapse.
fn space_text(value: &[char]) -> Vec<char> {
    let first = insert_separator_between(value, |previous, next| is_han(previous) && is_ascii_alnum(next));
    let second = insert_separator_between(&first, |previous, next| is_ascii_alnum(previous) && is_han(next));
    collapse_whitespace_runs(&second, ' ')
}

fn insert_separator_between<F>(value: &[char], matches: F) -> Vec<char>
where
    F: Fn(char, char) -> bool,
{
    let mut out: Vec<char> = Vec::with_capacity(value.len() + 8);
    let mut index = 0;
    while index < value.len() {
        out.push(value[index]);
        if index + 1 < value.len() && matches(value[index], value[index + 1]) {
            out.push(' ');
        }
        index += 1;
    }
    out
}

fn is_han(ch: char) -> bool {
    ch.script() == Script::Han
}

fn is_ascii_alnum(ch: char) -> bool {
    ch.is_ascii_alphanumeric()
}

/// The digit-run helpers below keep `\d` ASCII-only, which is what a
/// non-`u`-flagged JavaScript regex does.
fn ascii_digit_run_len(value: &str) -> usize {
    value.bytes().take_while(|byte| byte.is_ascii_digit()).count()
}

fn eq_ignore_case(value: &str, needle: &str) -> bool {
    lower_key(value) == lower_key(needle)
}

/// One alternative of the resolution-tag regex, applied to the whole brace
/// content (the surrounding `{`/`}` are already consumed by the scanner).
fn is_resolution_tag(content: &str) -> bool {
    is_pixels_tag(content) || is_downloading_tag(content) || is_size_suffix_tag(content)
}

/// `\d+(?:\.\d+)?[kKwW]?@(?:PX|WD)`
fn is_pixels_tag(content: &str) -> bool {
    let digits = ascii_digit_run_len(content);
    if digits == 0 {
        return false;
    }
    let mut rest = &content[digits..];
    if let Some(after_dot) = rest.strip_prefix('.') {
        let fraction = ascii_digit_run_len(after_dot);
        if fraction == 0 {
            return false;
        }
        rest = &after_dot[fraction..];
    }
    if let Some(after_unit) = rest.strip_prefix(['k', 'K', 'w', 'W']) {
        rest = after_unit;
    }
    let Some(after_at) = rest.strip_prefix('@') else {
        return false;
    };
    eq_ignore_case(after_at, "px") || eq_ignore_case(after_at, "wd")
}

/// `\d+%?@DE`
fn is_downloading_tag(content: &str) -> bool {
    let digits = ascii_digit_run_len(content);
    if digits == 0 {
        return false;
    }
    let rest = &content[digits..];
    let rest = rest.strip_prefix('%').unwrap_or(rest);
    match rest.strip_prefix('@') {
        Some(after_at) => eq_ignore_case(after_at, "de"),
        None => false,
    }
}

/// `\d+(?:w|p|px|de)`
fn is_size_suffix_tag(content: &str) -> bool {
    let digits = ascii_digit_run_len(content);
    if digits == 0 {
        return false;
    }
    let tail = &content[digits..];
    eq_ignore_case(tail, "w") || eq_ignore_case(tail, "p") || eq_ignore_case(tail, "px") || eq_ignore_case(tail, "de")
}

/// `cleanupName` (core.ts:238-260).
pub(crate) fn cleanup_name(value: &str) -> String {
    let mut chars: Vec<char> = value.nfkc().collect();
    fold_full_width_brackets(&mut chars);
    chars = remove_resolution_tag_brace_blocks(&chars);
    chars = remove_noise_tag_bracket_blocks(&chars);
    chars = remove_trailing_copy_counter(&chars);
    chars = remove_flat_brace_blocks(&chars);
    chars = collapse_empty_delimiter_blocks(&chars, '(', ')');
    chars = collapse_empty_delimiter_blocks(&chars, '[', ']');
    chars = collapse_whitespace_runs(&chars, ' ');
    chars = remove_duplicate_bracket_content(&chars);
    chars = replace_literal(&chars, "Digital", "DL");
    chars = replace_literal_case_insensitive(&chars, "PIXIV FANBOX", "FANBOX");
    chars = space_text(&chars);
    let spaced: String = chars.into_iter().collect();
    js_trim(&spaced).to_string()
}

/// `normalizeFolderName` (core.ts:234-236).
pub fn normalize_folder_name(name: &str) -> String {
    cleanup_name(name)
}

/// `normalizeArchiveName` (core.ts:225-232).
pub fn normalize_archive_name(filename: &str, artist_name: &str, rules: &NameuNameRules) -> String {
    let (base, extension) = split_extension(filename);
    let mut next = cleanup_name(base);
    let forbidden = rules
        .forbidden_artist_keywords
        .iter()
        .any(|keyword| includes_loose(&next, keyword) || includes_loose(artist_name, keyword));
    let excluded = rules
        .exclude_keywords
        .iter()
        .any(|keyword| includes_loose(&next, keyword) || includes_loose(artist_name, keyword));
    // No separator is inserted; the artist name is glued on exactly as the
    // template string in core.ts:230 does.
    if rules.add_artist_name && !forbidden && !excluded && !has_artist_name(&next, artist_name) {
        next.push_str(artist_name);
    }
    let mut out = truncate_smart(&next);
    out.push_str(extension);
    out
}

/// `splitExt` (core.ts:294-298): a leading dot and a name without a dot keep the
/// whole filename as the base.
fn split_extension(filename: &str) -> (&str, &str) {
    match filename.rfind('.') {
        Some(index) if index > 0 => (&filename[..index], &filename[index..]),
        _ => (filename, ""),
    }
}

fn truncate_smart(value: &str) -> String {
    if utf16_length(value) <= SMART_TRUNCATE_LIMIT_UTF16_UNITS {
        return value.to_string();
    }
    js_trim_end(&truncate_to_utf16_length(value, SMART_TRUNCATE_LIMIT_UTF16_UNITS)).to_string()
}

/// `hasArtistName` (core.ts:279-283).
pub(crate) fn has_artist_name(name: &str, artist_name: &str) -> bool {
    let artist = remove_js_whitespace(artist_name);
    let artist = lower_key(&artist);
    let filename = remove_js_whitespace(name);
    !artist.is_empty() && lower_key(&filename).contains(&artist)
}

/// `includesLoose` (core.ts:338-340): an empty keyword never matches.
pub(crate) fn includes_loose(value: &str, keyword: &str) -> bool {
    if keyword.is_empty() {
        return false;
    }
    let needle = lower_key(&remove_js_whitespace(keyword));
    if needle.is_empty() {
        return false;
    }
    lower_key(&remove_js_whitespace(value)).contains(&needle)
}

/// `isArchive` (core.ts:285-288).
pub(crate) fn is_archive(name: &str, archive_extensions: &[String]) -> bool {
    let lower = lower_key(name);
    archive_extensions
        .iter()
        .any(|extension| lower.ends_with(&lower_key(extension)))
}

/// `isExcludedPath` (core.ts:290-292): empty keywords are skipped, and the match
/// is case-insensitive over the whole path.
pub(crate) fn is_excluded_path(path: &str, keywords: &[String]) -> bool {
    let lower = lower_key(path);
    keywords
        .iter()
        .filter(|keyword| !keyword.is_empty())
        .any(|keyword| lower.contains(&lower_key(keyword)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules(add_artist_name: bool) -> NameuNameRules {
        NameuNameRules {
            add_artist_name,
            exclude_keywords: Vec::new(),
            forbidden_artist_keywords: Vec::new(),
        }
    }

    /// The case pinned by `core.test.ts:6-14`.
    #[test]
    fn normalize_archive_name_test_case_from_typescript() {
        assert_eq!(
            normalize_archive_name(
                "PIXIV FANBOX {3000@PX} [cbr] 作品.zip",
                "Artist",
                &NameuNameRules {
                    add_artist_name: true,
                    exclude_keywords: vec![],
                    forbidden_artist_keywords: vec![],
                }
            ),
            "FANBOX 作品Artist.zip"
        );
    }

    #[test]
    fn cleanup_name_table() {
        let cases = [
            ("Book [cbr].zip", "Book.zip"),
            ("[Foo] [foo] bar", "[Foo] bar"),
            ("name {1280x720} tail", "name tail"),
            ("name (1)", "name"),
            ("name  (2)", "name"),
            ("{100%@DE} art", "art"),
            ("{640p} art", "art"),
            ("{10w} art", "art"),
            ("Comic （Test） [ ] x", "Comic (Test) x"),
            ("【Group】 work", "[Group] work"),
            ("A Digital Book", "A DL Book"),
            ("pixiv fanbox 本", "FANBOX 本"),
            ("汉A汉B", "汉 A 汉 B"),
            ("a汉b汉", "a 汉 b 汉"),
            ("[samename_12] keep", "keep"),
            ("[multi-main] [trash] keep", "keep"),
        ];
        for (input, expected) in cases {
            assert_eq!(cleanup_name(split_extension(input).0), split_extension(expected).0, "input: {input}");
        }
    }

    #[test]
    fn artist_name_is_appended_only_when_missing() {
        assert_eq!(normalize_archive_name("Book.zip", "Artist", &rules(true)), "BookArtist.zip");
        // `hasArtistName` collapses whitespace, so "Book Artist" already carries "Artist"
        // and the append is skipped: the name is returned as `cleanupName` left it (core.ts:279-283).
        assert_eq!(normalize_archive_name("Book Artist.zip", "Artist", &rules(true)), "Book Artist.zip");
        assert_eq!(normalize_archive_name("Book.zip", "Artist", &rules(false)), "Book.zip");
    }

    #[test]
    fn forbidden_and_excluded_keywords_block_the_artist_name_on_both_sides() {
        let blocked = NameuNameRules {
            add_artist_name: true,
            exclude_keywords: vec!["[01来]".to_string()],
            forbidden_artist_keywords: vec!["[bili]".to_string()],
        };
        // A forbidden/excluded keyword only suppresses the artist append (`core.ts:228-230`);
        // `cleanupName` removes neither `[bili]` nor `[01来]` (they are not in its replacement
        // table at `core.ts:240-255`), so the bracketed token stays in the returned name.
        assert_eq!(normalize_archive_name("Book.zip", "Artist", &blocked), "BookArtist.zip");
        assert_eq!(normalize_archive_name("Book [bili].zip", "Artist", &blocked), "Book [bili].zip");
        assert_eq!(normalize_archive_name("Book.zip", "[bili] Artist", &blocked), "Book.zip");
        assert_eq!(normalize_archive_name("Book [01来].zip", "Artist", &blocked), "Book [01来].zip");
    }

    #[test]
    fn extension_and_leading_dot_are_preserved() {
        assert_eq!(normalize_archive_name("UPPER.ZIP", "Artist", &rules(false)), "UPPER.ZIP");
        assert_eq!(normalize_archive_name(".hidden", "Artist", &rules(true)), ".hiddenArtist");
        assert_eq!(normalize_archive_name("noext", "Artist", &rules(true)), "noextArtist");
    }

    #[test]
    fn long_names_truncate_at_eighty_utf16_units() {
        let long = "a".repeat(120);
        let result = normalize_archive_name(&format!("{long}.zip"), "Artist", &rules(false));
        assert_eq!(result, format!("{}.zip", "a".repeat(80)));

        let with_spaces = format!("{}   ", "b".repeat(85));
        let result = normalize_archive_name(&with_spaces, "Artist", &rules(false));
        assert_eq!(result, "b".repeat(80));

        let emoji = format!("{}😀", "c".repeat(79));
        assert_eq!(normalize_archive_name(&emoji, "", &rules(false)), "c".repeat(79));
    }

    #[test]
    fn duplicate_bracket_content_and_nested_braces() {
        // A `{` that meets another `{` before its `}` is not a match, so the
        // outer brace survives and only the inner block is deleted.
        assert_eq!(cleanup_name("{a {b} c} keep"), "{a c} keep");
        assert_eq!(cleanup_name("[x] y [X]"), "[x] y");
    }

    #[test]
    fn archive_and_exclusion_predicates() {
        let extensions = vec![".zip".to_string(), ".CBZ".to_string()];
        assert!(is_archive("A.ZIP", &extensions));
        assert!(is_archive("a.cbz", &extensions));
        assert!(!is_archive("a.pdf", &extensions));

        let keywords = vec!["[00待分类]".to_string(), String::new()];
        assert!(is_excluded_path("D:/[00待分类]/Artist", &keywords));
        assert!(!is_excluded_path("D:/Artist", &keywords));
        assert!(includes_loose("A B", "a b"));
        assert!(!includes_loose("A B", ""));
        assert!(has_artist_name("Book Artist", "ART IST"));
        assert!(!has_artist_name("Book", ""));
    }
}
