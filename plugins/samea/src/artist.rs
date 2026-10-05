//! Artist detection and the blacklist predicates: `core.ts:212-224` and `core.ts:243-248`.
//!
//! The bracket scanner is the node's whole idea — `[Circle (Artist A)] book.zip` names the artist, so the
//! artist becomes the folder — and it is pure string work, so it lives here with no filesystem in sight.
//!
//! ## Deviations, both of them
//!
//! * **Regex engine.** `regexBlacklist` (`core.ts:94`, `core.ts:248`) is a *user-authored* ECMAScript
//!   pattern list matched with `new RegExp(pattern, "i").test(value)`, and the `i` flag plus `\s` is why
//!   the `regex` crate here turns its `unicode` feature on. One real difference stays: a pattern using
//!   ECMAScript-only syntax (a lookahead, a backreference, `\p{…}` spelling) fails to compile in Rust, and
//!   `core.ts:248`'s `catch` already says what to do with a pattern that cannot compile — it never
//!   matches. So such a pattern silently stops filtering instead of throwing, exactly as an invalid
//!   pattern did in TypeScript. The shipped default `regexBlacklist` is empty
//!   (`interaction.ts:35`, `node-definitions/samea.json:253`), so the default path never touches this.
//! * **Case folding.** `toLocaleLowerCase()` (ICU, locale-aware) becomes `str::to_lowercase()` (Unicode
//!   default case folding). They differ only for Turkish `İ`/`i`-style special-casing; SameA compares an
//!   artist name against a blacklist the user typed, so locale is not available anyway.

use regex::Regex;

/// `core.ts:213` `/\[([^\[\]]+)\]/g`.
fn bracket_pattern() -> &'static Regex {
    static PATTERN: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"\[([^\[\]]+)\]").expect("the bracket pattern is a fixed literal and must compile")
    })
}

/// `core.ts:216` `/^(.+?)\s*\(([^()]+)\)$/`.
fn group_artist_pattern() -> &'static Regex {
    static PATTERN: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"^(.+?)\s*\(([^()]+)\)$")
            .expect("the circle/artist pattern is a fixed literal and must compile")
    })
}

/// `core.ts:244` `/^\[[^\[\]]+\]$/`.
fn artist_group_directory_pattern() -> &'static Regex {
    static PATTERN: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"^\[[^\[\]]+\]$")
            .expect("the group-directory pattern is a fixed literal and must compile")
    })
}

/// One user `regexBlacklist` entry, compiled once per run.
#[derive(Debug, Clone, Default)]
pub struct PatternList {
    entries: Vec<Option<Regex>>,
}

impl PatternList {
    /// Compiles every pattern with the `i` flag (`core.ts:248`).
    #[must_use]
    pub fn new(patterns: &[String]) -> Self {
        Self {
            entries: patterns
                .iter()
                .map(|pattern| Regex::new(&format!("(?i){pattern}")).ok())
                .collect(),
        }
    }

    /// An empty list, for the unit tests that call the predicates with no regex blacklist.
    #[must_use]
    pub fn empty() -> Self {
        Self { entries: Vec::new() }
    }

    /// `input.regexBlacklist.some((pattern) => matchesRegex(value, pattern))` (`core.ts:245-246`).
    #[must_use]
    pub fn any_matches(&self, value: &str) -> bool {
        self.entries.iter().flatten().any(|pattern| pattern.is_match(value))
    }
}

/// `Pick<Required<SameaInput>, "artistBlacklist" | "pathBlacklist" | "regexBlacklist">`, the three lists
/// the predicates read (`core.ts:245-246`).
#[derive(Debug, Clone, Copy)]
pub struct Blacklists<'a> {
    /// `artistBlacklist`, matched against an artist or candidate string.
    pub artist: &'a [String],
    /// `pathBlacklist`, matched against a path.
    pub path: &'a [String],
    /// The compiled `regexBlacklist`, shared by both.
    pub patterns: &'a PatternList,
}

impl Blacklists<'_> {
    /// `isArtistBlacklisted` (`core.ts:246`).
    #[must_use]
    pub fn artist_hit(&self, value: &str) -> bool {
        self.artist.iter().any(|term| includes_loose(value, term)) || self.patterns.any_matches(value)
    }

    /// `isPathBlacklisted` (`core.ts:245`).
    #[must_use]
    pub fn path_hit(&self, path: &str) -> bool {
        self.path.iter().any(|term| includes_loose(path, term)) || self.patterns.any_matches(path)
    }
}

/// `core.ts:169` `ArtistMatch`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtistMatch {
    /// `"<group>\0<artist>"` lowercased — the identity two archives share when they name the same artist
    /// (`core.ts:221`). The NUL cannot appear in a file name, so it is a safe separator.
    pub key: String,
    /// The bracketed label that becomes the folder name (`core.ts:220`).
    pub label: String,
}

/// `extractArtist` (`core.ts:212-224`), verbatim in order and in short-circuit behaviour:
/// first bracket wins unless it is blacklisted as a whole or its artist half is.
#[must_use]
pub fn extract_artist(filename: &str, blacklists: &Blacklists<'_>) -> Option<ArtistMatch> {
    for candidate in bracket_candidates(filename) {
        if blacklists.artist_hit(&candidate) {
            continue;
        }
        let (group, artist) = match group_artist_pattern().captures(&candidate) {
            Some(captures) => {
                let group = captures
                    .get(1)
                    .map(|matched| matched.as_str().trim().to_string())
                    .unwrap_or_default();
                let artist = captures
                    .get(2)
                    .map(|matched| matched.as_str().trim().to_string())
                    .unwrap_or_else(|| candidate.clone());
                (group, artist)
            }
            None => (String::new(), candidate.clone()),
        };
        if artist.is_empty() || blacklists.artist_hit(&artist) {
            continue;
        }
        let label = if group.is_empty() {
            format!("[{artist}]")
        } else {
            format!("[{group} ({artist})]")
        };
        return Some(ArtistMatch {
            key: format!("{group}\0{artist}").to_lowercase(),
            label,
        });
    }
    None
}

/// `filename.matchAll(/\[([^\[\]]+)\]/g)` then `.trim()` then `.filter(Boolean)` (`core.ts:213`).
#[must_use]
pub fn bracket_candidates(filename: &str) -> Vec<String> {
    bracket_pattern()
        .captures_iter(filename)
        .map(|captures| captures[1].trim().to_string())
        .filter(|candidate| !candidate.is_empty())
        .collect()
}

/// `isArchive` (`core.ts:243`): case-insensitive suffix test against the lowercased extension list.
#[must_use]
pub fn is_archive(name: &str, extensions: &[String]) -> bool {
    let lowered = name.to_lowercase();
    extensions.iter().any(|extension| lowered.ends_with(extension.as_str()))
}

/// `isArtistGroupDirectory` (`core.ts:244`) — a whole trimmed name that is one bracket pair.
#[must_use]
pub fn is_artist_group_directory(name: &str) -> bool {
    artist_group_directory_pattern().is_match(name.trim())
}

/// `includesLoose` (`core.ts:247`): an empty term never matches, otherwise a case-folded substring test.
#[must_use]
fn includes_loose(value: &str, term: &str) -> bool {
    !term.is_empty() && value.to_lowercase().contains(&term.to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_lists() -> Blacklists<'static> {
        static EMPTY: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
        static PATTERNS: std::sync::OnceLock<PatternList> = std::sync::OnceLock::new();
        Blacklists {
            artist: EMPTY.get_or_init(Vec::new),
            path: EMPTY.get_or_init(Vec::new),
            patterns: PATTERNS.get_or_init(PatternList::empty),
        }
    }

    #[test]
    fn circle_and_artist_split_the_first_bracket() {
        // `core.test.ts:7`, the node's own expectation.
        let found = extract_artist("[Circle (Artist A)] book.zip", &no_lists()).expect("artist");
        assert_eq!(found.key, "circle\0artist a");
        assert_eq!(found.label, "[Circle (Artist A)]");
        // Negative control: a second bracket never wins over the first.
        let second = extract_artist("[First] [Second] a.zip", &no_lists()).expect("artist");
        assert_eq!(second.label, "[First]");
    }

    #[test]
    fn a_single_name_bracket_has_no_group() {
        let found = extract_artist("[Artist] one.zip", &no_lists()).expect("artist");
        assert_eq!(found.key, "\0artist");
        assert_eq!(found.label, "[Artist]");
    }

    #[test]
    fn blacklist_terms_are_loose_and_the_empty_term_rule_holds() {
        let artist = vec!["various".to_string()];
        let empty_term = vec![String::new()];
        let lists = Blacklists { artist: &artist, path: &[], patterns: &PatternList::empty() };
        assert!(lists.artist_hit("[Various] collection.7z"));
        // Negative control: an empty term must not match everything (`core.ts:247` `Boolean(term)`).
        let blank = Blacklists { artist: &empty_term, path: &[], patterns: &PatternList::empty() };
        assert!(!blank.artist_hit("anything"));
        assert!(!lists.artist_hit("[Pixiv] art.zip"));
    }

    #[test]
    fn a_blacklisted_candidate_falls_through_to_the_next_bracket() {
        // `core.ts:215`: the whole candidate is tested first, so `[Various] [Artist]` yields Artist.
        let artist = vec!["various".to_string()];
        let lists =
            Blacklists { artist: &artist, path: &[], patterns: &PatternList::empty() };
        let found = extract_artist("[Various] [Artist] a.zip", &lists).expect("artist");
        assert_eq!(found.label, "[Artist]");
    }

    #[test]
    fn regex_blacklist_matches_loosely_and_an_invalid_pattern_never_matches() {
        let patterns = PatternList::new(&["^pixiv$".to_string()]);
        let lists = Blacklists { artist: &[], path: &[], patterns: &patterns };
        assert!(lists.artist_hit("pixiv"));
        assert!(!lists.artist_hit("pixiv art"));
        // `core.ts:248`'s catch: an uncompilable ECMAScript pattern reads as "no match".
        let broken = PatternList::new(&["(".to_string()]);
        assert!(!broken.any_matches("anything"));
    }

    #[test]
    fn archive_and_group_directory_tests_use_the_lowercased_extension_list() {
        let extensions = vec![".zip".to_string(), ".7z".to_string()];
        assert!(is_archive("A.ZIP", &extensions));
        assert!(!is_archive("a.rar", &extensions), "the shipped default includes .rar, this list does not");
        assert!(is_artist_group_directory("[Artist]"));
        assert!(!is_artist_group_directory("[Artist] one.zip"));
        assert!(!is_artist_group_directory("[a]b]"));
    }
}
