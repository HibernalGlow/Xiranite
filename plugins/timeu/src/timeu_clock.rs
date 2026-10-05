//! Millisecond clock arithmetic that stays pure, with the tick itself hosted.
//!
//! `wasm32-unknown-unknown` has no wall clock, and the TypeScript core got its
//! `backedUpAt` from `runtime.now().toISOString()` (`core.ts:119`, `core.ts:170`),
//! so the host supplies epoch milliseconds and this module reproduces
//! `Date.prototype.toISOString` byte for byte. Keeping the formatting on this side
//! is what makes the record file diffable against one written by the old core.

use std::fmt;

/// `Date.prototype.toISOString` range: `|t| <= 8.64e15` ms, and the year must fit
/// in the 0000-9999 window ECMAScript allows for the four-digit form.
pub const MAX_TIME_VALUE_MS: f64 = 8.64e15;

/// A time value `toISOString` would have rejected with a `RangeError`, which the
/// TypeScript catch at `core.ts:140` turned into `Invalid time value`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TimeuClockError {
    InvalidTimeValue,
}

impl fmt::Display for TimeuClockError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidTimeValue => formatter.write_str("Invalid time value"),
        }
    }
}

impl std::error::Error for TimeuClockError {}

/// ECMAScript `Math.round`: half toward `+Infinity`, not half away from zero.
///
/// `core.ts:176-179` rounds the four `stat` fields, so a fractional `atimeMs` of
/// `-0.6` has to land on `-0`-ish `0` the way V8 does, and `0.5`/`1.5` have to
/// round up. `f64::round` is half-away-from-zero, which is a different function.
pub fn js_math_round(value: f64) -> f64 {
    if value.is_nan() || value.is_infinite() || value == 0.0 {
        return value;
    }
    (value + 0.5).floor()
}

/// `new Date(epoch_ms).toISOString()`.
pub fn iso8601_from_epoch_ms(epoch_ms: f64) -> Result<String, TimeuClockError> {
    if !epoch_ms.is_finite() || epoch_ms.abs() > MAX_TIME_VALUE_MS {
        return Err(TimeuClockError::InvalidTimeValue);
    }

    // ECMAScript reads the fields off the *floored* time value, so pre-1970
    // timestamps stay consistent with `Date`'s own getters.
    let millis = epoch_ms.floor();
    // The range check above keeps this inside `i64`, so the field math below can
    // use `div_euclid`/`rem_euclid` instead of floating-point modulo.
    let total_ms = millis as i64;

    let ms = total_ms.rem_euclid(1_000);
    let total_seconds = total_ms.div_euclid(1_000);
    let second = total_seconds.rem_euclid(60);
    let total_minutes = total_seconds.div_euclid(60);
    let minute = total_minutes.rem_euclid(60);
    let total_hours = total_minutes.div_euclid(60);
    let hour = total_hours.rem_euclid(24);
    let days = total_hours.div_euclid(24);

    let (year, month, day) = civil_from_days(days);
    if year < 0 || year > 9999 {
        return Err(TimeuClockError::InvalidTimeValue);
    }

    Ok(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{ms:03}Z"
    ))
}

/// Days since 1970-01-01 to a proleptic-Gregorian `(year, month, day)`.
///
/// Howard Hinnant's `civil_from_days`, which is what `Date`'s UTC getters resolve
/// to. Integer-only, and using `div_euclid`/`rem_euclid` where the C++ original
/// relied on a non-negative operand, so pre-1970 days land in the right century.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_phase = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_phase + 2) / 5 + 1;
    let month = if month_phase < 10 { month_phase + 3 } else { month_phase - 9 };
    let year_adjustment = if month <= 2 { 1 } else { 0 };
    (year + year_adjustment, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_matches_ecmascript_half_up() {
        let cases: [(f64, f64); 8] = [
            (0.5, 1.0),
            (1.5, 2.0),
            (2.5, 3.0),
            (-0.5, 0.0),
            (-1.5, -1.0),
            (1000.4, 1000.0),
            (1000.6, 1001.0),
            (f64::NAN, f64::NAN),
        ];
        for (input, expected) in cases {
            let actual = js_math_round(input);
            if expected.is_nan() {
                assert!(actual.is_nan(), "round({input}) should stay NaN");
            } else {
                assert_eq!(actual, expected, "round({input})");
            }
        }
    }

    #[test]
    fn iso8601_matches_to_iso_string() {
        let cases: [(f64, &str); 6] = [
            (0.0, "1970-01-01T00:00:00.000Z"),
            (1_000.0, "1970-01-01T00:00:01.000Z"),
            (1_767_225_600_000.0, "2026-01-01T00:00:00.000Z"),
            (1_767_225_600_123.0, "2026-01-01T00:00:00.123Z"),
            (-1.0, "1969-12-31T23:59:59.999Z"),
            (-2_208_988_800_000.0, "1900-01-01T00:00:00.000Z"),
        ];
        for (epoch_ms, expected) in cases {
            assert_eq!(iso8601_from_epoch_ms(epoch_ms).unwrap(), expected, "{epoch_ms}");
        }
    }

    #[test]
    fn out_of_range_time_values_reject_like_date_does() {
        for value in [f64::NAN, f64::INFINITY, MAX_TIME_VALUE_MS + 1.0, -MAX_TIME_VALUE_MS - 1.0] {
            assert_eq!(
                iso8601_from_epoch_ms(value),
                Err(TimeuClockError::InvalidTimeValue),
                "{value}"
            );
        }
        assert_eq!(
            TimeuClockError::InvalidTimeValue.to_string(),
            "Invalid time value"
        );
    }

    #[test]
    fn leap_day_and_month_boundaries_format_correctly() {
        // 2024-02-29T00:00:00.000Z and 2024-03-01T00:00:00.000Z
        assert_eq!(
            iso8601_from_epoch_ms(1_709_164_800_000.0).unwrap(),
            "2024-02-29T00:00:00.000Z"
        );
        assert_eq!(
            iso8601_from_epoch_ms(1_709_251_200_000.0).unwrap(),
            "2024-03-01T00:00:00.000Z"
        );
        assert_eq!(
            iso8601_from_epoch_ms(1_704_067_199_000.0).unwrap(),
            "2023-12-31T23:59:59.000Z"
        );
    }
}
