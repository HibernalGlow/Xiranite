//! The output ordering rule: `core.ts:114-116` `localeSort`.
//!
//! The TypeScript is `a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })`, which
//! is an ICU collation with three properties a byte comparison does not have: case-insensitive,
//! accent-insensitive (base strength), and digit runs compared as numbers (`item2 < item10`).
//!
//! ## Why this is hand-written and where the dependency went instead
//!
//! `unicode-normalization` does the part that must not be hand-written — canonical decomposition,
//! which is what makes `café` and `cafe` compare equal at base strength. The rest is ours because no
//! Rust crate expresses this exact triplet: `icu_collator` has no numeric-collation option at all
//! (ICU4X exposes strength and `alternate`, not `setNumeric`), it needs a compiled collation data
//! crate, and it pulls locale tailoring that would make the order depend on the host locale rather
//! than on the fixed order the node's own tests already assert.
//!
//! ## Documented deviations from ICU, in priority order
//!
//! 1. **Ties stay ties.** Lines that compare equal return [`std::cmp::Ordering::Equal`] and the sort
//!    is stable, so source order breaks the tie — the same result `Array#sort` gives since ES2019.
//!    `["Beta", "beta"]` therefore keeps its order. ICU behaves the same way at base strength.
//! 2. **Only the Latin/combining ranges fold.** Marks outside [`COMBINING_MARK_RANGES`] (Hebrew,
//!    Arabic, Thai vowel marks) keep their code points, so those scripts compare case-folded but not
//!    mark-folded. Deterministic, and outside the node's stated domain of "names, IDs, paths, or
//!    tags" (`help.ts:8`).
//! 3. **ASCII digits only.** A run of `0-9` is a number; `U+0661` ARABIC-INDIC DIGIT ONE is a
//!    character.
//! 4. **No final-sigma rule.** `char::to_lowercase` maps `Σ` to `σ` wherever it appears while JS
//!    produces `ς` at a word end. Both sides of a pair fold the same way for the common cases, so base
//!    strength still reports `ΣΣ` and `σσ` as equal; a mixed `Σσ` vs `σς` pair may order differently
//!    and still yields a total, stable order.
//! 5. **Punctuation keeps code-point order.** CLDR gives punctuation its own primary weights; here it
//!    sorts by code point, which agrees with CLDR's root collation for `!"#$%&'()*+,-./:` and the
//!    bracket group, so ordinary Windows paths and tag lists order as before.

use std::cmp::Ordering;

use unicode_normalization::UnicodeNormalization as _;

/// Canonical combining marks (Mn/Me plus the variation selectors) that base strength ignores, as
/// inclusive code-point bounds so [`is_combining_mark`] stays a `const fn`.
const COMBINING_MARK_RANGES: &[(u32, u32)] = &[
    (0x0300, 0x036F), // Combining Diacritical Marks
    (0x1AB0, 0x1AFF), // Combining Diacritical Marks Extended
    (0x1DC0, 0x1DFF), // Combining Diacritical Marks Supplement
    (0x20D0, 0x20FF), // Combining Marks for Symbols
    (0xFE00, 0xFE0F), // Variation Selectors
    (0xFE20, 0xFE2F), // Combining Half Marks
];

const fn is_combining_mark(ch: char) -> bool {
    let point = ch as u32;
    let mut index = 0;
    while index < COMBINING_MARK_RANGES.len() {
        let (start, end) = COMBINING_MARK_RANGES[index];
        if point >= start && point <= end {
            return true;
        }
        index += 1;
    }
    false
}

/// One comparable piece of a line: a digit run compared by value, or a folded character run.
///
/// `Digits` is declared first so the variant ordering puts numbers before letters, matching CLDR's
/// root order (`"1a" < "a1"`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NaturalChunk {
    /// A run of ASCII digits with leading zeros removed: `"007"` and `"7"` are the same number.
    Digits { significant: Vec<char> },
    /// A maximal non-digit run after NFD decomposition, mark removal and lowercasing.
    Text(Vec<char>),
}

impl Ord for NaturalChunk {
    fn cmp(&self, other: &Self) -> Ordering {
        match (self, other) {
            // A digit run compares as a number: more significant digits means a larger value, and only
            // equal-length runs fall back to lexicographic order. `derive(Ord)` on the `Vec<char>` would
            // compare `'1'` against `'2'` first and put `item10` before `item2`, which is exactly the
            // `numeric: true` behaviour `core.ts:115` asked for.
            (Self::Digits { significant: left }, Self::Digits { significant: right }) => {
                left.len().cmp(&right.len()).then_with(|| left.cmp(right))
            }
            (Self::Text(left), Self::Text(right)) => left.cmp(right),
            (Self::Digits { .. }, Self::Text(_)) => Ordering::Less,
            (Self::Text(_), Self::Digits { .. }) => Ordering::Greater,
        }
    }
}

impl PartialOrd for NaturalChunk {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// The base-strength, numeric-aware sort key of one line.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct NaturalSortKey(Vec<NaturalChunk>);

impl NaturalSortKey {
    /// Builds the key for `value`.
    #[must_use]
    pub fn new(value: &str) -> Self {
        Self(chunkize(value))
    }

    /// The chunk sequence, exposed for tests and for a face that wants to show why two lines tied.
    #[must_use]
    pub fn chunks(&self) -> &[NaturalChunk] {
        &self.0
    }
}

/// Splits `value` into digit runs and folded text runs in source order.
fn chunkize(value: &str) -> Vec<NaturalChunk> {
    let mut chunks: Vec<NaturalChunk> = Vec::new();
    let mut text: Vec<char> = Vec::new();
    let mut digits: Vec<char> = Vec::new();

    for ch in value
        .nfd()
        .filter(|ch| !is_combining_mark(*ch))
        .flat_map(char::to_lowercase)
    {
        if ch.is_ascii_digit() {
            if !text.is_empty() {
                chunks.push(NaturalChunk::Text(std::mem::take(&mut text)));
            }
            digits.push(ch);
        } else {
            if !digits.is_empty() {
                chunks.push(finish_digits(std::mem::take(&mut digits)));
            }
            text.push(ch);
        }
    }

    if !digits.is_empty() {
        chunks.push(finish_digits(digits));
    }
    if !text.is_empty() {
        chunks.push(NaturalChunk::Text(text));
    }
    chunks
}

fn finish_digits(mut raw: Vec<char>) -> NaturalChunk {
    let leading_zeros = raw.iter().take_while(|ch| **ch == '0').count();
    raw.drain(..leading_zeros);
    NaturalChunk::Digits { significant: raw }
}

/// `core.ts:115`'s comparator, as a total order on the key (deviations documented at the module).
#[must_use]
pub fn compare_natural(left: &str, right: &str) -> Ordering {
    NaturalSortKey::new(left).cmp(&NaturalSortKey::new(right))
}

/// Sorts in place with the node's collation, stably.
///
/// Decorate-sort-undecorate: one key per line, so an N-line paste costs O(N log N) comparisons over
/// precomputed keys instead of O(N log N) Unicode decompositions. The strings are moved out and back
/// rather than cloned, which is what keeps a large source list inside `memory_max_pages`.
/// [`slice::sort_by`] is stable, and that is the property tie behaviour depends on.
pub fn natural_sort(lines: &mut [String]) {
    let taken: Vec<String> = lines.iter_mut().map(std::mem::take).collect();
    let mut keyed: Vec<(NaturalSortKey, String)> = taken
        .into_iter()
        .map(|line| (NaturalSortKey::new(&line), line))
        .collect();
    keyed.sort_by(|left, right| left.0.cmp(&right.0));
    for (index, (_, line)) in keyed.into_iter().enumerate() {
        lines[index] = line;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sorted(lines: &[&str]) -> Vec<String> {
        let mut owned: Vec<String> = lines.iter().map(|line| (*line).to_owned()).collect();
        natural_sort(&mut owned);
        owned
    }

    #[test]
    fn plain_words_order_like_the_vitest_case() {
        // core.test.ts:23 expects ["alpha", "gamma"]; core.test.ts:24 expects the beta pair.
        assert_eq!(sorted(&["gamma", "alpha"]), ["alpha", "gamma"]);
        assert_eq!(sorted(&["beta-two", "beta-one"]), ["beta-one", "beta-two"]);
    }

    #[test]
    fn digit_runs_compare_by_value_not_by_character() {
        assert_eq!(sorted(&["item10", "item2"]), ["item2", "item10"]);
        assert_eq!(compare_natural("a007", "a7"), Ordering::Equal, "leading zeros are not weight");
        assert_eq!(compare_natural("1a", "a1"), Ordering::Less, "numbers precede letters");
    }

    #[test]
    fn base_strength_ignores_case_and_accents_and_keeps_source_order_on_a_tie() {
        assert_eq!(sorted(&["Beta", "alpha"]), ["alpha", "Beta"]);
        assert_eq!(
            sorted(&["Beta", "beta"]),
            ["Beta", "beta"],
            "equal at base strength, so the stable sort must not swap them"
        );
        assert_eq!(compare_natural("café", "cafe"), Ordering::Equal);
        assert_eq!(compare_natural("École", "ecole"), Ordering::Equal);
    }

    #[test]
    fn a_large_list_sorts_through_the_precomputed_keys() {
        let mut lines: Vec<String> = (0..400).map(|index| format!("row{:03}", 399 - index)).collect();
        natural_sort(&mut lines);
        assert_eq!(lines.first().expect("non-empty"), "row000");
        assert_eq!(lines.last().expect("non-empty"), "row399");
        assert_eq!(lines.len(), 400, "sorting must not drop or duplicate lines");
    }

    #[test]
    fn an_empty_key_has_no_chunks() {
        assert!(NaturalSortKey::new("").chunks().is_empty());
        assert_eq!(compare_natural("", ""), Ordering::Equal);
    }
}
