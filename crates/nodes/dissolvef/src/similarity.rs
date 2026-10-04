//! Name similarity: the guard that keeps DissolveF from merging two unrelated folders.
//!
//! Port of `calculateDissolvefSimilarity` / `checkDissolvefSimilarity` and their private helpers
//! (`core.ts:232-249`, `core.ts:756-797`). The four sub-scores and the `max` over them are the product's
//! safety property, so nothing here is simplified:
//!
//! 1. Levenshtein ratio of the whole normalized names.
//! 2. A containment bonus when one name is a substring of the other.
//! 3. Levenshtein ratio after sorting the whitespace-separated tokens, so word order does not matter.
//! 4. Token-set ratio, so a folder full of extra words still matches its archive.
//!
//! Deliberate boundary differences from JavaScript, both recorded because they only show up on non-BMP or
//! case-folding-sensitive names:
//!
//! - Code points instead of UTF-16 code units. `core.ts:785-797` indexes strings, so an astral-plane
//!   character (an emoji) counts as two there and one here.
//! - `char::is_whitespace` instead of the JS `\s` class, and `char::to_lowercase` instead of V8's
//!   context-aware case mapping (final sigma). BMP letters, digits, CJK and whitespace agree.

use std::collections::BTreeSet;

use crate::paths::strip_extension;

/// The two characters that separate tokens after `normalizeName` collapsed the rest into spaces.
const TOKEN_SEPARATOR: char = ' ';

/// `normalizeName` (`core.ts:756-762`): drop the extension, lowercase, turn bracket/underscore runs into
/// single spaces, trim.
#[must_use]
pub fn normalize_name(name: &str) -> String {
    let lowered = strip_extension(name).to_lowercase();
    let mut collapsed = String::with_capacity(lowered.len());
    let mut inside_symbol_run = false;
    for character in lowered.chars() {
        if is_name_symbol(character) {
            inside_symbol_run = true;
            continue;
        }
        if inside_symbol_run {
            collapsed.push(TOKEN_SEPARATOR);
            inside_symbol_run = false;
        }
        collapsed.push(character);
    }
    if inside_symbol_run {
        collapsed.push(TOKEN_SEPARATOR);
    }
    collapse_whitespace(&collapsed).trim().to_string()
}

/// `[_\-.[\](){}` plus whitespace — the punctuation `core.ts:759-760` replaces with a space.
fn is_name_symbol(character: char) -> bool {
    matches!(character, '_' | '-' | '.' | '[' | ']' | '(' | ')' | '{' | '}') || character.is_whitespace()
}

fn collapse_whitespace(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut previous_was_whitespace = false;
    for character in value.chars() {
        if character.is_whitespace() {
            if !previous_was_whitespace {
                result.push(TOKEN_SEPARATOR);
            }
            previous_was_whitespace = true;
            continue;
        }
        previous_was_whitespace = false;
        result.push(character);
    }
    result
}

/// `sortTokens` (`core.ts:764-766`).
#[must_use]
pub fn sort_tokens(value: &str) -> String {
    let mut tokens: Vec<&str> = value.split(TOKEN_SEPARATOR).filter(|token| !token.is_empty()).collect();
    tokens.sort_by(|left, right| compare_names_locale_aware(left, right));
    tokens.join(" ")
}

/// Ordering used where `core.ts` called `localeCompare`.
///
/// ICU collation is not available inside the plugin, so this approximates its primary level: case-insensitive
/// first, then the raw code-point order as the tie-break. For the all-lowercase Latin and CJK names this node
/// compares it agrees with `localeCompare`; a mixed-case folder list may come out in a different order, which
/// changes which candidate path gets the `_1` suffix, not what gets dissolved.
#[must_use]
pub fn compare_names_locale_aware(left: &str, right: &str) -> std::cmp::Ordering {
    let left_key = left.to_lowercase();
    let right_key = right.to_lowercase();
    left_key.cmp(&right_key).then_with(|| left.cmp(right))
}

/// `tokenSetRatio` (`core.ts:768-777`).
#[must_use]
pub fn token_set_ratio(left: &str, right: &str) -> f64 {
    let first = token_set(left);
    let second = token_set(right);
    if first.is_empty() || second.is_empty() {
        return 0.0;
    }
    let intersection = first.iter().filter(|token| second.contains(*token)).count();
    (2.0 * intersection as f64) / (first.len() + second.len()) as f64
}

fn token_set(value: &str) -> BTreeSet<String> {
    value.split(TOKEN_SEPARATOR).filter(|token| !token.is_empty()).map(str::to_string).collect()
}

/// `levenshteinRatio` (`core.ts:779-783`).
#[must_use]
pub fn levenshtein_ratio(left: &str, right: &str) -> f64 {
    let maximum = left.chars().count().max(right.chars().count());
    if maximum == 0 {
        return 1.0;
    }
    1.0 - (levenshtein_distance(left, right) as f64) / maximum as f64
}

/// `levenshteinDistance` (`core.ts:785-797`), the same two-row dynamic programme, over code points.
#[must_use]
pub fn levenshtein_distance(left: &str, right: &str) -> usize {
    let source: Vec<char> = left.chars().collect();
    let target: Vec<char> = right.chars().collect();
    let mut previous: Vec<usize> = (0..=target.len()).collect();
    let mut current = vec![0usize; target.len() + 1];
    for i in 1..=source.len() {
        current[0] = i;
        for j in 1..=target.len() {
            let cost = usize::from(source[i - 1] != target[j - 1]);
            current[j] = (current[j - 1] + 1)
                .min(previous[j] + 1)
                .min(previous[j - 1] + cost);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[target.len()]
}

/// `calculateDissolvefSimilarity` (`core.ts:232-243`).
#[must_use]
pub fn calculate_dissolvef_similarity(left: &str, right: &str) -> f64 {
    let first = normalize_name(left);
    let second = normalize_name(right);
    if first.is_empty() || second.is_empty() {
        return 0.0;
    }
    if first == second {
        return 1.0;
    }
    let ratio = levenshtein_ratio(&first, &second);
    let partial = if first.contains(&second) || second.contains(&first) {
        let first_len = first.chars().count() as f64;
        let second_len = second.chars().count() as f64;
        first_len.min(second_len) / first_len.max(second_len)
    } else {
        0.0
    };
    let token_sort = levenshtein_ratio(&sort_tokens(&first), &sort_tokens(&second));
    let token_set = token_set_ratio(&first, &second);
    ratio.max(partial).max(token_sort).max(token_set)
}

/// `checkDissolvefSimilarity` (`core.ts:245-249`) — `passed` plus the score the plan row reports.
#[must_use]
pub fn check_dissolvef_similarity(
    parent_name: &str,
    child_name: &str,
    threshold: f64,
) -> DissolvefSimilarityCheck {
    if threshold <= 0.0 {
        return DissolvefSimilarityCheck { passed: true, similarity: 1.0 };
    }
    let similarity = calculate_dissolvef_similarity(parent_name, child_name);
    DissolvefSimilarityCheck { passed: similarity >= threshold, similarity }
}

/// The pair `checkDissolvefSimilarity` returns (`core.ts:245`'s `{ passed, similarity }`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DissolvefSimilarityCheck {
    pub passed: bool,
    pub similarity: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization_drops_extension_and_brackets() {
        assert_eq!(normalize_name("series_a.zip"), "series a");
        // `normalizeName` strips the extension FIRST (`core.ts:757`), so `stripExtension` cuts at the
        // last dot of the whole name and the rest of the string never reaches the bracket pass.
        assert_eq!(normalize_name("3. CG [bonus] {extra}"), "3");
        assert_eq!(normalize_name("CG [bonus] {extra}"), "cg bonus extra");
        assert_eq!(normalize_name("  Double   Space  "), "double space");
        assert_eq!(normalize_name("Alpha-Beta"), "alpha beta");
        // A leading dot is not an extension (`strip_extension` keeps `core.ts:747`'s `index > 0`), but it
        // is still punctuation that normalizes away.
        assert_eq!(normalize_name(".hidden"), "hidden");
        assert_eq!(normalize_name("a."), "a");
        assert_eq!(normalize_name(""), "");
    }

    #[test]
    fn identical_names_after_normalization_score_one() {
        assert_eq!(calculate_dissolvef_similarity("series_a", "series_a.zip"), 1.0);
        assert_eq!(calculate_dissolvef_similarity("Album Vol.1.zip", "album vol 1"), 1.0);
    }

    #[test]
    fn unrelated_names_stay_below_the_default_threshold() {
        // `core.test.ts:20`
        assert!(calculate_dissolvef_similarity("alpha", "beta") < 0.9);
        // `1 - 4/5` is 0.19999999999999996 in f64, which is also what JavaScript produced.
        assert!(
            (calculate_dissolvef_similarity("alpha", "beta") - 0.2).abs() < 1e-12,
            "{}",
            calculate_dissolvef_similarity("alpha", "beta")
        );
        assert_eq!(calculate_dissolvef_similarity("", "beta"), 0.0);
        assert_eq!(calculate_dissolvef_similarity("beta", ""), 0.0);
    }

    #[test]
    fn token_order_does_not_matter() {
        assert_eq!(calculate_dissolvef_similarity("work best 2024", "best 2024 work"), 1.0);
        assert_eq!(sort_tokens("beta alpha alpha"), "alpha alpha beta");
    }

    #[test]
    fn containment_and_token_sets_lift_partial_matches() {
        // Containment lifts `patreon` / `patreon work 2024` to 7/17, and the token set (1 of 1 and 3) lifts
        // it further to 0.5, which is what `Math.max` of the four scores returns (`core.ts:242`).
        let contained = calculate_dissolvef_similarity("patreon", "patreon work 2024");
        assert!(contained > levenshtein_ratio("patreon", "patreon work 2024"));
        assert!((contained - 0.5).abs() < 1e-12, "{contained}");
        // Token set: one shared token out of three and three.
        assert!((token_set_ratio("a b c", "a d e") - 1.0 / 3.0).abs() < 1e-12);
        assert_eq!(token_set_ratio("", "a"), 0.0);
        assert_eq!(token_set_ratio("a a", "a"), 1.0);
    }

    #[test]
    fn levenshtein_matches_the_typescript_table() {
        assert_eq!(levenshtein_distance("", ""), 0);
        assert_eq!(levenshtein_distance("kitten", "sitting"), 3);
        assert_eq!(levenshtein_distance("flaw", "lawn"), 2);
        assert_eq!(levenshtein_ratio("", ""), 1.0);
        assert_eq!(levenshtein_ratio("ab", "ab"), 1.0);
    }

    #[test]
    fn non_ascii_names_compare_by_code_point() {
        assert_eq!(calculate_dissolvef_similarity("同人志", "同人志.zip"), 1.0);
        assert!(calculate_dissolvef_similarity("同人志合集", "商业志") < 0.9);
    }

    #[test]
    fn a_zero_threshold_always_passes_and_reports_one() {
        let check = check_dissolvef_similarity("alpha", "beta", 0.0);
        assert!(check.passed);
        assert_eq!(check.similarity, 1.0);
        let negative = check_dissolvef_similarity("alpha", "beta", -1.0);
        assert!(negative.passed);
    }

    #[test]
    fn the_threshold_decides_against_the_raw_score() {
        let passed = check_dissolvef_similarity("series_a", "series_a.zip", 0.9);
        assert!(passed.passed);
        let failed = check_dissolvef_similarity("alpha", "beta", 0.6);
        assert!(!failed.passed);
        assert!((failed.similarity - 0.2).abs() < 1e-12);
        // `>=`, as `core.ts:248` writes it: a score exactly on the threshold passes.
        assert!(check_dissolvef_similarity("abcd", "abce", 0.75).passed);
    }
}
