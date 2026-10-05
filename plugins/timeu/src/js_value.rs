//! ECMAScript value coercions for the JSON documents the preserved protocol carries.
//!
//! `core.ts` reads its input through `String(value ?? "")`, truthiness and
//! `value ?? default` rather than through a validating parser, so a request whose
//! `recursive` is `0` behaves like `false` and a `path` of `12` behaves like
//! `"12"`. The React UI and the HTTP payload stay untouched (ADR-0063
//! principles 1-3), so the port reproduces those coercions instead of rejecting
//! the inputs the old core silently accepted.

use serde_json::Value;

/// `String(value ?? "")` from `clean`/`parseList` (`core.ts:259`, `core.ts:267`).
pub fn js_string_of_value(value: Option<&Value>) -> String {
    match value {
        // `??` short-circuits on both `undefined` (absent key) and `null`.
        None | Some(Value::Null) => String::new(),
        Some(Value::Bool(flag)) => {
            if *flag { "true".to_string() } else { "false".to_string() }
        }
        Some(Value::Number(number)) => js_number_text(number.as_f64().unwrap_or(0.0)),
        Some(Value::String(text)) => text.clone(),
        // `String([1, null, "x"])` is `"1,,x"`: elements go through the same
        // coercion, joined with commas, and null/undefined collapse to "".
        Some(Value::Array(items)) => {
            let mut rendered = String::new();
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    rendered.push(',');
                }
                rendered.push_str(&js_string_of_value(Some(item)));
            }
            rendered
        }
        Some(Value::Object(_)) => "[object Object]".to_string(),
    }
}

/// `value ?? fallback` for a string field, keeping the raw text when present.
pub fn js_string_or_fallback(value: Option<&Value>, fallback: &str) -> String {
    match value {
        None | Some(Value::Null) => fallback.to_string(),
        Some(other) => js_string_of_value(Some(other)),
    }
}

/// ECMAScript `String(number)` for the magnitudes TimeU sees.
///
/// Integral values below 1e21 print without a decimal point, like
/// `JSON.stringify` does for the record file; anything else falls back to Rust's
/// `Display`, which differs from ECMAScript's `ToString` only for exponents and
/// subnormals that cannot appear in a millisecond timestamp or a path list.
pub fn js_number_text(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value == f64::INFINITY {
        return "Infinity".to_string();
    }
    if value == f64::NEG_INFINITY {
        return "-Infinity".to_string();
    }
    // `0` and `-0` both stringify to "0".
    if value == 0.0 {
        return "0".to_string();
    }
    if value.fract() == 0.0 && value.abs() < 1e21 {
        return format!("{}", value as i128);
    }
    format!("{value}")
}

/// Truthiness as `core.ts:153`/`core.ts:159` apply it to `recursive` and
/// `includeDirectories`. Objects and arrays are truthy even when empty, matching
/// JavaScript, because the old core never tested `.length`.
pub fn js_truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => match number.as_f64() {
            Some(as_float) => as_float != 0.0 && !as_float.is_nan(),
            None => true,
        },
        Some(Value::String(text)) => !text.is_empty(),
        Some(Value::Array(_)) | Some(Value::Object(_)) => true,
    }
}

/// `value ?? fallback` for a boolean field: only `null`/absent take the default,
/// so `false`, `0` and `""` stay their own falsy values (`core.ts:87-89`).
pub fn js_bool_or_fallback(value: Option<&Value>, fallback: bool) -> bool {
    match value {
        None | Some(Value::Null) => fallback,
        Some(other) => js_truthy(Some(other)),
    }
}

/// Reads a property the way `object.key` does: absent or `null` become `None`.
pub fn property_of<'value>(object: Option<&'value Value>, key: &str) -> Option<&'value Value> {
    match object? {
        Value::Object(fields) => fields.get(key),
        // `String(undefined)` for a non-object base is what the old core saw when
        // `input` itself was a string or number; nothing in TimeU reads a
        // property from those, so they read as absent.
        _ => None,
    }
}

/// Outcome of `...input.paths` (`core.ts:84`), which is a spread, not a read.
#[derive(Debug, Clone, PartialEq)]
pub enum SpreadMembers {
    /// An array spreads to its own elements.
    Elements(Vec<Value>),
    /// A string spreads to its characters, which is what `..."/a"` did in the
    /// old core and why a single path in `paths` silently became fragments.
    Characters(Vec<Value>),
    /// Anything else throws `... is not iterable`, which `runTimeu` catches and
    /// turns into a failure result.
    NotIterable,
}

pub fn spread_members(value: Option<&Value>) -> SpreadMembers {
    match value {
        None | Some(Value::Null) => SpreadMembers::Elements(Vec::new()),
        // `...undefined` and `...null` spread to nothing, so `?? []` is implied.
        Some(Value::Array(items)) => SpreadMembers::Elements(items.clone()),
        Some(Value::String(text)) => SpreadMembers::Characters(
            text.chars().map(|character| Value::String(character.to_string())).collect(),
        ),
        Some(Value::Bool(_)) | Some(Value::Number(_)) | Some(Value::Object(_)) => {
            SpreadMembers::NotIterable
        }
    }
}
