//! `Date.parse` for the ISO-8601 shapes the log writer emits, ported as the telemetry clock source.

/// Epoch milliseconds, or `None` where `Date.parse` would return `NaN` (`core.ts:116`).
///
/// Zone-less date-times are read as UTC: JavaScript would shift them by the machine's local zone, and a
/// plugin has no local zone. Every envelope timestamp comes from `Date::toISOString`, which is `Z`-terminated.
pub fn parse_epoch_milliseconds(text: &str) -> Option<i64> {
    let bytes = text.trim().as_bytes();
    let year = digit_run_value(bytes, 0, 4)?;
    if bytes.get(4) != Some(&b'-') {
        return None;
    }
    let month = digit_run_value(bytes, 5, 2)?;
    if bytes.get(7) != Some(&b'-') {
        return None;
    }
    let day = digit_run_value(bytes, 8, 2)?;
    // Day and hour ranges match V8's `Date.parse`, which rolls 2026-02-29 and 24:00 forward instead of
    // rejecting them; `days_from_civil` does the same rollover arithmetically.
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let mut position = 10;
    let mut milliseconds = days_from_civil(year, month, day) * 86_400_000;

    if position < bytes.len() {
        if !matches!(bytes.get(position), Some(b'T') | Some(b't') | Some(b' ')) {
            return None;
        }
        position += 1;
        let hour = digit_run_value(bytes, position, 2)?;
        if bytes.get(position + 2) != Some(&b':') {
            return None;
        }
        let minute = digit_run_value(bytes, position + 3, 2)?;
        position += 5;
        if !(0..=24).contains(&hour) || !(0..=59).contains(&minute) {
            return None;
        }
        milliseconds += hour * 3_600_000 + minute * 60_000;

        if bytes.get(position) == Some(&b':') {
            let second = digit_run_value(bytes, position + 1, 2)?;
            position += 3;
            if !(0..=59).contains(&second) {
                return None;
            }
            milliseconds += second * 1_000;
            if bytes.get(position) == Some(&b'.') {
                let fraction_length = digit_count_at(bytes, position + 1);
                if fraction_length == 0 {
                    return None;
                }
                let fraction = digit_run_value(bytes, position + 1, fraction_length)?;
                let scale = 10_i64.pow(fraction_length as u32);
                milliseconds += fraction * 1_000 / scale;
                position += 1 + fraction_length;
            }
        }
    }

    let offset_milliseconds = match bytes.get(position) {
        None => 0,
        Some(b'Z') | Some(b'z') => {
            position += 1;
            0
        }
        Some(marker @ (b'+' | b'-')) => {
            let sign = if *marker == b'-' { -1 } else { 1 };
            let offset_hours = digit_run_value(bytes, position + 1, 2)?;
            let (offset_minutes, next_position) = match bytes.get(position + 3) {
                Some(b':') => (digit_run_value(bytes, position + 4, 2)?, position + 6),
                Some(byte) if byte.is_ascii_digit() => {
                    (digit_run_value(bytes, position + 3, 2)?, position + 5)
                }
                _ => (0, position + 3),
            };
            if offset_hours > 23 || offset_minutes > 59 {
                return None;
            }
            position = next_position;
            sign * (offset_hours * 3_600_000 + offset_minutes * 60_000)
        }
        _ => return None,
    };
    if position != bytes.len() {
        return None;
    }
    Some(milliseconds - offset_milliseconds)
}

fn digit_run_value(bytes: &[u8], start: usize, length: usize) -> Option<i64> {
    let window = bytes.get(start..start.checked_add(length)?)?;
    if window.iter().all(u8::is_ascii_digit) {
        let mut value = 0;
        for byte in window {
            value = value * 10 + i64::from(byte - b'0');
        }
        Some(value)
    } else {
        None
    }
}

fn digit_count_at(bytes: &[u8], start: usize) -> usize {
    let mut count = 0;
    while matches!(bytes.get(start + count), Some(byte) if byte.is_ascii_digit()) {
        count += 1;
    }
    count
}

/// Days from the Unix epoch for a proleptic Gregorian date (Howard Hinnant's `days_from_civil`).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let shifted_year = if month > 2 { year } else { year - 1 };
    let era = if shifted_year >= 0 {
        shifted_year
    } else {
        shifted_year - 399
    } / 400;
    let year_of_era = shifted_year - era * 400;
    let month_index = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_envelope_timestamp_shape() {
        assert_eq!(
            parse_epoch_milliseconds("2026-07-23T00:00:01.000Z"),
            Some(1_784_764_801_000)
        );
        assert_eq!(
            parse_epoch_milliseconds("2026-07-23T00:00:01.000Z"),
            parse_epoch_milliseconds("2026-07-23T00:00:00Z").map(|value| value + 1_000)
        );
    }

    #[test]
    fn date_only_and_offset_forms_agree_with_utc_reading() {
        assert_eq!(
            parse_epoch_milliseconds("2026-07-23"),
            parse_epoch_milliseconds("2026-07-23T00:00:00Z")
        );
        assert_eq!(
            parse_epoch_milliseconds("2026-07-23T08:00:00+08:00"),
            parse_epoch_milliseconds("2026-07-23T00:00:00Z")
        );
        assert_eq!(
            parse_epoch_milliseconds("2026-07-23T08:00:00+0800"),
            parse_epoch_milliseconds("2026-07-23T08:00:00+08:00")
        );
        assert_eq!(
            parse_epoch_milliseconds("2026-07-22T16:00:00-08:00"),
            parse_epoch_milliseconds("2026-07-23T00:00:00Z")
        );
        assert_eq!(
            parse_epoch_milliseconds("2026-07-23T00:00"),
            parse_epoch_milliseconds("2026-07-23T00:00:00Z")
        );
    }

    #[test]
    fn rolls_invalid_days_and_hour_24_forward_like_v8() {
        assert_eq!(
            parse_epoch_milliseconds("2026-02-29T00:00:00Z"),
            parse_epoch_milliseconds("2026-03-01T00:00:00Z")
        );
        assert_eq!(
            parse_epoch_milliseconds("2026-07-23T24:00:00Z"),
            parse_epoch_milliseconds("2026-07-24T00:00:00Z")
        );
    }

    #[test]
    fn rejects_the_inputs_date_parse_would_return_nan_for() {
        for text in [
            "",
            "---- session legacy ----",
            "2026-13-01T00:00:00Z",
            "2026-07-32T00:00:00Z",
            "2026-07-23T00:60:00Z",
            "2026-07-23T00:00:60Z",
            "2026-07-23T1:00:00Z",
            "2026-07-23T00:00:00Z trailing",
            "2026-07-23T00:00:00+08:60",
            "2026-07-23T00:00:00.Z",
            "2026/07/23T00:00:00Z",
        ] {
            assert_eq!(parse_epoch_milliseconds(text), None, "{text}");
        }
    }

    #[test]
    fn leap_days_and_sub_millisecond_precision() {
        assert!(parse_epoch_milliseconds("2024-02-29T00:00:00Z").is_some());
        assert_eq!(
            parse_epoch_milliseconds("2026-07-23T00:00:00.9999Z"),
            parse_epoch_milliseconds("2026-07-23T00:00:00.999Z")
        );
    }

    #[test]
    fn epoch_day_zero_is_the_unix_epoch() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2026, 7, 23), 20_657);
    }
}
