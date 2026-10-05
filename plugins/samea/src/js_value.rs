//! ECMAScript coercions for the JSON documents the preserved protocol carries.
//!
//! `packages/nodes/samea/src/core.ts` never validates its input: it reads through `String(value ?? "")`
//! (`core.ts:251`), truthiness (`core.ts:172`, `core.ts:190`) and `value ?? default` (`core.ts:82-95`).
//! A request whose `centralize` is `0` therefore behaves like `false`, a `minOccurrences` of `"7"` behaves
//! like `7`, and `null` is not the same thing as an absent key. The React UI and the HTTP payload stay
//! untouched (ADR-0063 principles 1-3), so this port reproduces those coercions instead of rejecting the
//! inputs the old core silently accepted.
//!
//! Only the coercions `samea` actually reaches are implemented here, and each one names the TypeScript
//! line it answers to.

use serde_json::Value;

/// `String(value ?? "")` as used by `clean` and `parseList` (`core.ts:249`, `core.ts:251`).
#[must_use]
pub fn js_string_of_value(value: Option<&Value>) -> String {
    match value {
        // `??` short-circuits on both `undefined` (absent key) and `null`.
        None | Some(Value::Null) => String::new(),
        Some(Value::Bool(flag)) => {
            if *flag { "true".to_string() } else { "false".to_string() }
        }
        Some(Value::Number(number)) => js_number_text(number.as_f64().unwrap_or(0.0)),
        Some(Value::String(text)) => text.clone(),
        // `String([1, null, "x"])` is `"1,,x"`: elements go through the same coercion and are joined
        // with commas, with null/undefined collapsing to "".
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

/// ECMAScript `String(number)` for the magnitudes this node sees: an occurrence threshold and the
/// counters that reach `interaction.ts:45`'s preview lines.
///
/// Integral values below 1e21 print without a decimal point, like `JSON.stringify` does; anything else
/// falls back to Rust's `Display`, which differs from ECMAScript's `ToString` only for exponents and
/// subnormals that cannot appear in a clamped 1..100 counter or a file count.
#[must_use]
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

/// Truthiness as `core.ts:172`/`core.ts:190` apply it to `ignorePathBlacklist`, and as `core.ts:92-95`
/// applies it to `artistBlacklist?.length`. Empty arrays and empty strings are falsy here because those
/// two call sites test `.length`; everywhere else a boolean flag reads through [`js_bool_or_fallback`].
#[must_use]
pub fn js_truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => match number.as_f64() {
            Some(as_float) => as_float != 0.0 && !as_float.is_nan(),
            None => true,
        },
        Some(Value::String(text)) => !text.is_empty(),
        Some(Value::Array(items)) => !items.is_empty(),
        Some(Value::Object(_)) => true,
    }
}

/// `value ?? fallback` for a boolean field (`core.ts:86-91`): only `null`/absent take the default, so
/// `false`, `0` and `""` stay their own falsy values.
#[must_use]
pub fn js_bool_or_fallback(value: Option<&Value>, fallback: bool) -> bool {
    match value {
        None | Some(Value::Null) => fallback,
        Some(other) => js_truthy_value(Some(other)),
    }
}

/// Truthiness without the array `.length` rule, for the boolean flags `??` defaults feed.
///
/// `core.ts:86-91` never tests a boolean for length, so `[]` is truthy there while `core.ts:92` tests
/// `artistBlacklist?.length`. Two functions, because the two spellings genuinely differ in JavaScript.
fn js_truthy_value(value: Option<&Value>) -> bool {
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

/// `Number(value)` (`core.ts:253`), returning `None` for `NaN` so `clamp_int` can apply its fallback.
///
/// The ECMAScript cases this node can actually receive: `null` is `0`, `true`/`false` are `1`/`0`, a
/// string is trimmed then parsed (`""` is `0`, `"12.5"` is `12.5`, anything else is `NaN`), an
/// empty array is `0`, a single-element array is its element, and an object is `NaN`.
#[must_use]
pub fn js_number_of(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Null => Some(0.0),
        Value::Bool(flag) => Some(if *flag { 1.0 } else { 0.0 }),
        Value::Number(number) => Some(number.as_f64().unwrap_or(f64::NAN)),
        Value::String(text) => js_number_of_string(text),
        Value::Array(items) => match items.len() {
            0 => Some(0.0),
            1 => js_number_of(Some(items.first()?)),
            _ => None,
        },
        Value::Object(_) => None,
    }
}

/// `Number(text)`: whitespace-only and empty strings are `0`, otherwise the ECMAScript `NumericLiteral`
/// grammar in the narrow form a threshold field can contain (decimal, optional sign, optional exponent;
/// `0x` hexadecimal is accepted because `Number("0x10")` is `16`).
fn js_number_of_string(text: &str) -> Option<f64> {
    let trimmed = text.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    if trimmed.is_empty() {
        return Some(0.0);
    }
    if let Some(hex) = trimmed.strip_prefix("0x").or(trimmed.strip_prefix("0X")) {
        return u64::from_str_radix(hex, 16).ok().map(|value| value as f64);
    }
    parse_f64(trimmed)
}

/// `parseFloat` over ECMAScript's decimal form, rejecting the suffixes Rust accepts (`1.5f32`, `1e_2`)
/// and the ones it rejects but JavaScript also rejects (`Infinity` is `NaN` for `Number()` only when
/// the text is not exactly `Infinity`; that spelling never reaches `clamp_int` from this node).
fn parse_f64(text: &str) -> Option<f64> {
    let (sign, digits) = match text.strip_prefix('+') {
        Some(rest) => (1.0f64, rest),
        None => match text.strip_prefix('-') {
            Some(rest) => (-1.0f64, rest),
            None => (1.0f64, text),
        },
    };
    if digits.is_empty() {
        return None;
    }
    let value = digits.parse::<f64>().ok()?;
    if value.is_nan() {
        return None;
    }
    Some(sign * value)
}

/// `Math.round` (`core.ts:253`): half towards positive infinity, which is not Rust's round-half-away.
#[must_use]
pub fn js_math_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// `[...new Set(values.map(clean).filter(Boolean))]` (`core.ts:250`).
#[must_use]
pub fn unique_preserving_order(values: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(values.len());
    for value in values {
        if !out.contains(&value) {
            out.push(value);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn string_coercion_follows_null_absent_and_compound_values() {
        assert_eq!(js_string_of_value(None), "");
        assert_eq!(js_string_of_value(Some(&Value::Null)), "");
        assert_eq!(js_string_of_value(Some(&json!(true))), "true");
        assert_eq!(js_string_of_value(Some(&json!(12))), "12");
        assert_eq!(js_string_of_value(Some(&json!(" /a "))), " /a ");
        assert_eq!(js_string_of_value(Some(&json!([1, null, "x"]))), "1,,x");
        assert_eq!(js_string_of_value(Some(&json!({ "a": 1 }))), "[object Object]");
    }

    #[test]
    fn boolean_defaulting_only_accepts_null_and_absent() {
        // `core.ts:91` `input.dryRun ?? true`: absent and null both take the default.
        assert!(js_bool_or_fallback(None, true));
        assert!(!js_bool_or_fallback(None, false));
        assert!(js_bool_or_fallback(Some(&Value::Null), true));
        assert!(!js_bool_or_fallback(Some(&json!(false)), true));
        assert!(!js_bool_or_fallback(Some(&json!(0)), true));
        // `core.ts:86-91` never tests a flag for length, so `[]` is truthy there…
        assert!(js_bool_or_fallback(Some(&json!([])), false));
        // …while `core.ts:92` tests `artistBlacklist?.length`, where `[]` is falsy.
        assert!(!js_truthy(Some(&json!([]))));
    }

    #[test]
    fn number_coercion_matches_the_threshold_field() {
        assert_eq!(js_number_of(None), None);
        assert_eq!(js_number_of(Some(&Value::Null)), Some(0.0));
        assert_eq!(js_number_of(Some(&json!("7"))), Some(7.0));
        assert_eq!(js_number_of(Some(&json!("  "))), Some(0.0));
        assert_eq!(js_number_of(Some(&json!("abc"))), None, "Number(\"abc\") is NaN");
        assert_eq!(js_number_of(Some(&json!({}))), None);
        assert_eq!(js_number_of(Some(&json!([3]))), Some(3.0));
        assert_eq!(js_number_of(Some(&json!([1, 2]))), None);
        assert_eq!(js_math_round(1.5), 2.0);
        assert_eq!(js_math_round(-1.5), -1.0, "Math.round is half-up, not half-away");
    }

    #[test]
    fn unique_preserving_order_drops_later_duplicates_only() {
        assert_eq!(
            unique_preserving_order(vec!["b".to_string(), "a".to_string(), "b".to_string()]),
            vec!["b".to_string(), "a".to_string()]
        );
    }
}
