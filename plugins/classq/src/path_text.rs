//! Separator-neutral path *text* helpers — the four functions `ClassqRuntime` injected into the TypeScript core.
//!
//! `core.ts:71-74` declares `join`/`dirname`/`basename`/`relative` as runtime callbacks and `platform.ts:29-32`
//! binds them to `node:path`, while `core.test.ts:94-97` binds them to small POSIX rules. Those two spellings agree
//! on every path a plan can actually produce (a keyword folder is always `parent/name`, and `relative` is only ever
//! called on a descendant of the root: `core.ts:180`, `:196`), so this module implements that shared behaviour rather
//! than picking a side. ADR-0071 §5 is the reason it stays text: a `wasm32-wasip1` guest sees POSIX separators and
//! cannot tell `D:/set` from `D:set`, so host-shaped analysis belongs to the host, not to the plugin.
//!
//! Deliberate deviations, recorded rather than hidden:
//!
//! 1. `join_path` collapses the parent's trailing separators instead of normalizing interior `..`/`.` segments the
//!    way `node:path.join` does. Every call site builds `parent/name` from a listing, so nothing gains a `..`.
//! 2. `path_relative` returns the POSIX display form (`wait/pending.zip`), matching `core.test.ts:38-42`; a Windows
//!    `node:path.relative` produced `wait\\pending.zip`. `targetRelative` is display text only — the transfer uses
//!    `targetPath`.
//! 3. `path_relative` falls back to the untouched `to` when `to` is not under `from`, which is `core.test.ts:97`'s
//!    rule. `node:path` would answer `../sibling`; no plan branch reaches that case.

/// The characters both spellings treat as separators (`core.test.ts:95-96`).
fn is_separator(character: char) -> bool {
    character == '/' || character == '\\'
}

/// The separator `join_path` appends: the one the parent already uses (`platform.ts:29` on Windows gives `\`,
/// `core.test.ts:94` gives `/`).
#[must_use]
pub fn inferred_path_separator(parent: &str) -> char {
    if parent.contains('\\') { '\\' } else { '/' }
}

/// `runtime.join(...)` (`core.ts:71`, `platform.ts:29`).
///
/// The two arguments are the only shape the core uses: `join(parent, waitKeyword)` (`core.ts:146`, `:172`) and
/// `join(waitDir, source.name)` (`core.ts:188`).
#[must_use]
pub fn join_path(parent: &str, name: &str) -> String {
    let trimmed = parent.trim_end_matches(is_separator);
    if name.is_empty() {
        return trimmed.to_owned();
    }
    if name.starts_with(is_separator) {
        // A listing never yields an absolute name; keep the parent's prefix rather than inventing `//`.
        return format!("{trimmed}{}", name.trim_start_matches(is_separator));
    }
    if trimmed.is_empty() {
        return format!("{}{name}", inferred_path_separator(parent));
    }
    format!("{trimmed}{}{name}", inferred_path_separator(parent))
}

/// `runtime.dirname` (`core.ts:72`, `platform.ts:30`).
///
/// `"/root/already"` becomes `"/root"`; a one-component path keeps its separator root (`"/already"` becomes `"/"`),
/// which is what `node:path` answers and what `core.test.ts:95`'s `|| "."` produced only because its fixture never
/// names a folder at the filesystem root.
#[must_use]
pub fn path_dirname(path: &str) -> String {
    let trimmed = path.trim_end_matches(is_separator);
    let Some(index) = trimmed.rfind(is_separator) else {
        // No separator at all: `node:path.dirname("already")` is `"."`.
        return ".".to_string();
    };
    let parent = &trimmed[..index];
    if parent.is_empty() {
        // `"/already"` → `"/"`, and `"C:\already"` keeps its drive root.
        return format!("{parent}{}", &trimmed[index..index + 1]);
    }
    parent.to_owned()
}

/// `runtime.basename` (`core.ts:73`, `platform.ts:31`, `core.test.ts:96`).
#[must_use]
pub fn path_basename(path: &str) -> String {
    let trimmed = path.trim_end_matches(is_separator);
    match trimmed.rfind(is_separator) {
        Some(index) => trimmed[index + 1..].to_owned(),
        None => trimmed.to_owned(),
    }
}

/// `runtime.relative(rootPath, targetPath)` (`core.ts:74`, `platform.ts:32`), in POSIX display form.
#[must_use]
pub fn path_relative(from: &str, to: &str) -> String {
    let from_key = normalize_path_key(from);
    let to_key = normalize_path_key(to);
    if from_key == to_key {
        return String::new();
    }
    let prefix = format!("{from_key}/");
    if to_key.starts_with(&prefix) {
        return to[prefix.len()..].replace('\\', "/");
    }
    to.to_owned()
}

/// `normalizePath` (`core.ts:249-251`): the identity key `buildClassqPlan` dedupes parents and skips the keyword
/// folder and the wait folder with (`core.ts:141`, `:149-150`). Forward slashes are folded in and the result is
/// lower-cased, so a Windows plan and a POSIX plan agree on "same place".
#[must_use]
pub fn normalize_path_key(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

/// `entry.name.toLowerCase().includes(keywordLower)` (`core.ts:151`, `:165`).
#[must_use]
pub fn name_contains_keyword(name: &str, keyword_lower: &str) -> bool {
    name.to_lowercase().contains(keyword_lower)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_keeps_the_parents_separator() {
        assert_eq!(join_path("/root", "wait"), "/root/wait");
        assert_eq!(join_path("/root/", "wait"), "/root/wait");
        assert_eq!(join_path("D:\\set", "wait"), "D:\\set\\wait");
        assert_eq!(join_path("/", "already"), "/already");
    }

    #[test]
    fn dirname_and_basename_round_trip_a_listing_path() {
        let folder = join_path("/root/series", "already");
        assert_eq!(path_dirname(&folder), "/root/series");
        assert_eq!(path_basename(&folder), "already");
        assert_eq!(path_basename("/root/already/"), "already");
    }

    #[test]
    fn relative_produces_the_display_form_the_tests_expect() {
        // `core.test.ts:38-42` expects exactly these three strings.
        assert_eq!(path_relative("/root", "/root/wait"), "wait");
        assert_eq!(path_relative("/root", "/root/wait/pending.zip"), "wait/pending.zip");
        assert_eq!(path_relative("/root", "/root"), "");
        // A Windows root with a POSIX-shaped listing child still resolves, because the key is separator-neutral.
        assert_eq!(path_relative("D:\\set", "D:/set/wait/a.txt"), "wait/a.txt");
    }

    #[test]
    fn relative_refuses_to_invent_a_parent_walk() {
        // Negative control for the case above: an unrelated path is returned untouched rather than as `../x`.
        assert_eq!(path_relative("/root", "/other/wait"), "/other/wait");
        assert_ne!(path_relative("/root", "/rootx/wait"), "wait");
    }

    #[test]
    fn identity_keys_fold_separators_and_case() {
        assert_eq!(normalize_path_key("D:\\Set\\Wait"), "d:/set/wait");
        // Negative control: two paths that differ only by case/separator are the same place to the planner.
        assert_eq!(normalize_path_key("/a/b"), normalize_path_key("/A\\b"));
    }
}
