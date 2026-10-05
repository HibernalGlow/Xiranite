//! JavaScript text semantics the ported core depends on.
//!
//! `packages/nodes/snf/src/core.ts` is written against ECMAScript string and
//! regular-expression behaviour, and its output is a product contract the React
//! card reads (`src/nodes/snf/Component.tsx`). Rust's `str` helpers are close to
//! those rules but not identical, and the differences land on real folder names,
//! so every place the port needs them is named here instead of being inlined.

use serde_json::Value;

/// ECMAScript `WhiteSpace` plus `LineTerminator`, the set `\s` and
/// `String.prototype.trim` use.
///
/// `char::is_whitespace` follows the Unicode `White_Space` property, which
/// agrees with ECMAScript everywhere except U+FEFF: the ZERO WIDTH NO-BREAK
/// SPACE is `White_Space=No` in current Unicode but is still ECMAScript
/// whitespace, so `\uFEFF` and `\uFEFF` in a folder name would otherwise become
/// part of the parsed name or the parsed number's neighbour.
pub const fn is_javascript_whitespace(character: char) -> bool {
    character.is_whitespace() || character == '\u{FEFF}'
}

/// `String.prototype.trim`.
pub fn trim_javascript_whitespace(value: &str) -> &str {
    let start = value
        .char_indices()
        .find(|(_, character)| !is_javascript_whitespace(*character))
        .map_or(value.len(), |(index, _)| index);
    let end = value
        .char_indices()
        .rfind(|(_, character)| !is_javascript_whitespace(*character))
        .map_or(start, |(index, character)| index + character.len_utf8());
    &value[start..end]
}

/// ECMAScript `String.prototype.toLowerCase`.
///
/// Rust's `str::to_lowercase` is the same full Unicode mapping for the scripts
/// folder names use, including the `U+0130 -> i + U+0307` case the conflict set
/// in `plan_artist_folder` compares case-insensitively. The final-sigma special
/// case is the only known divergence and needs a Greek folder name to be
/// observable at all.
pub fn lower_case_like_javascript(value: &str) -> String {
    value.to_lowercase()
}

/// ECMAScript `String(value ?? "")` for the JSON shapes a node input can carry.
///
/// Scalars become their textual form (`3 -> "3"`, `true -> "true"`), exactly like
/// the `clean()` / `String()` calls at `core.ts:223` and `core.ts:215`. `null`,
/// absent and structured values become `None`: TypeScript would render an object
/// as `"[object Object]"` and keep it as a path, which is garbage either way, so
/// the port drops it and lets the "at least one folder" rule report it.
pub fn coerce_to_javascript_string(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::Bool(flag) => Some(flag.to_string()),
        Value::Number(number) => Some(number.to_string()),
        Value::String(text) => Some(text.clone()),
        Value::Array(_) | Value::Object(_) => None,
    }
}

/// `String(value ?? "").split(/\r?\n|,/)` followed by `map(trim)` and
/// `filter(Boolean)`, the exact chain of `parseList` at `core.ts:215-217`.
///
/// A lone `\r` is not a separator: ECMAScript only consumes `\r` when it is
/// directly before `\n`, so `"a\rb"` stays one item.
pub fn split_list_into_trimmed_items(value: &str) -> Vec<String> {
    let mut items = Vec::new();
    let mut current = String::new();
    let mut previous_was_carriage_return = false;
    for character in value.chars() {
        if character == '\n' {
            if previous_was_carriage_return {
                current.pop();
            }
            push_item(&mut items, &mut current);
            previous_was_carriage_return = false;
            continue;
        }
        if character == ',' {
            push_item(&mut items, &mut current);
            previous_was_carriage_return = false;
            continue;
        }
        previous_was_carriage_return = character == '\r';
        current.push(character);
    }
    push_item(&mut items, &mut current);
    items
}

fn push_item(items: &mut Vec<String>, current: &mut String) {
    let item = trim_javascript_whitespace(current.as_str()).to_string();
    if !item.is_empty() {
        items.push(item);
    }
    current.clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trim_matches_the_javascript_whitespace_set() {
        assert_eq!(trim_javascript_whitespace("\u{FEFF} D:/a \u{FEFF}"), "D:/a");
        assert_eq!(trim_javascript_whitespace("\r\n\u{3000}x\u{3000}\r\n"), "x");
        assert_eq!(trim_javascript_whitespace("   "), "");
        assert_eq!(trim_javascript_whitespace(""), "");
    }

    #[test]
    fn carriage_return_only_joins_a_line_feed() {
        assert_eq!(
            split_list_into_trimmed_items("a\rb\nD:/x,,D:/y,\r\nD:/z"),
            vec!["a\rb", "D:/x", "D:/y", "D:/z"]
        );
        assert_eq!(split_list_into_trimmed_items("  \n  ,  "), Vec::<String>::new());
    }

    #[test]
    fn scalars_coerce_like_the_string_function() {
        assert_eq!(coerce_to_javascript_string(&Value::String("a".into())).as_deref(), Some("a"));
        assert_eq!(coerce_to_javascript_string(&Value::from(3)).as_deref(), Some("3"));
        assert_eq!(coerce_to_javascript_string(&Value::Bool(true)).as_deref(), Some("true"));
        assert_eq!(coerce_to_javascript_string(&Value::Null), None);
        assert_eq!(coerce_to_javascript_string(&Value::Array(vec![])), None);
    }

    #[test]
    fn lower_case_keeps_the_conflict_comparison_stable() {
        assert_eq!(lower_case_like_javascript("1. CG"), "1. cg");
        assert_eq!(lower_case_like_javascript("1. ＣＧ"), lower_case_like_javascript("1. ｃｇ"));
    }
}
