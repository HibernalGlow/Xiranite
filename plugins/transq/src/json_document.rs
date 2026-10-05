//! A strict, dependency-free JSON reader.
//!
//! Two TransQ payloads must be decoded inside the sandbox: the node input
//! (`{"action":..,"paths":[..],"preview":..}`) and manga-translator's
//! `translation_map.json`, whose key list is the batch plan's source of truth
//! (`platform.ts:118-126`). Both are small, host-authored, and hostile-input
//! reachable only through the user's own project folder, so the reader stays
//! single-pass, borrows unchanged strings, and bounds nesting instead of pulling
//! in a serde dependency for three shapes.

use std::borrow::Cow;
use std::collections::HashSet;
use std::fmt;

/// Guards the WASM sandbox against a deeply nested map file exhausting the stack.
pub const MAX_JSON_NESTING_DEPTH: usize = 64;

/// A decoded JSON document. Numbers stay as raw text because TransQ never reads
/// one; `preview` is the only number-ish field and it is a boolean.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JsonValue<'a> {
    Null,
    Boolean(bool),
    Number(&'a str),
    String(Cow<'a, str>),
    Array(Vec<JsonValue<'a>>),
    Object(Vec<(Cow<'a, str>, JsonValue<'a>)>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsonParseError {
    pub message: String,
    pub byte_offset: usize,
}

impl fmt::Display for JsonParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{} at byte {}", self.message, self.byte_offset)
    }
}

impl std::error::Error for JsonParseError {}

impl<'a> JsonValue<'a> {
    /// Mirrors `JSON.parse` duplicate-key handling: the last member wins.
    pub fn get(&self, key: &str) -> Option<&JsonValue<'a>> {
        match self {
            JsonValue::Object(members) => members
                .iter()
                .rev()
                .find(|(name, _)| &**name == key)
                .map(|(_, value)| value),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            JsonValue::Boolean(value) => Some(*value),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            JsonValue::String(value) => Some(&**value),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[JsonValue<'a>]> {
        match self {
            JsonValue::Array(values) => Some(values),
            _ => None,
        }
    }

    /// `Object.keys(parsed).sort()` from `platform.ts:122`, with two details that
    /// matter: `null` and arrays are not key sources (`parsed && typeof parsed ===
    /// "object" && !Array.isArray(parsed)`), and a JS object key list already
    /// collapsed duplicates, keeping the first insertion position.
    pub fn sorted_unique_object_keys(&self) -> Vec<String> {
        let JsonValue::Object(members) = self else {
            return Vec::new();
        };
        let mut keys: Vec<String> = Vec::with_capacity(members.len());
        let mut seen: HashSet<&str> = HashSet::new();
        for (name, _) in members {
            let key: &str = name;
            if seen.insert(key) {
                keys.push(key.to_string());
            }
        }
        keys.sort();
        keys
    }
}

pub fn parse_json(text: &str) -> Result<JsonValue<'_>, JsonParseError> {
    let mut cursor = JsonCursor { text, index: 0 };
    cursor.skip_whitespace();
    let value = cursor.parse_value(0)?;
    cursor.skip_whitespace();
    if cursor.index < text.len() {
        return Err(cursor.error("trailing content after JSON value"));
    }
    Ok(value)
}

struct JsonCursor<'a> {
    text: &'a str,
    index: usize,
}

impl<'a> JsonCursor<'a> {
    fn skip_whitespace(&mut self) {
        while let Some(byte) = self.peek_byte() {
            if matches!(byte, b' ' | b'\t' | b'\n' | b'\r') {
                self.index += 1;
            } else {
                break;
            }
        }
    }

    fn peek_byte(&self) -> Option<u8> {
        self.text.as_bytes().get(self.index).copied()
    }

    fn error(&self, message: &str) -> JsonParseError {
        JsonParseError { message: message.to_string(), byte_offset: self.index }
    }

    fn parse_value(&mut self, depth: usize) -> Result<JsonValue<'a>, JsonParseError> {
        if depth > MAX_JSON_NESTING_DEPTH {
            return Err(self.error("JSON nesting deeper than the sandbox allows"));
        }
        match self.peek_byte() {
            Some(b'{') => self.parse_object(depth),
            Some(b'[') => self.parse_array(depth),
            Some(b'"') => Ok(JsonValue::String(self.parse_string()?)),
            Some(b't') => self.parse_literal("true", JsonValue::Boolean(true)),
            Some(b'f') => self.parse_literal("false", JsonValue::Boolean(false)),
            Some(b'n') => self.parse_literal("null", JsonValue::Null),
            Some(byte) if byte == b'-' || byte.is_ascii_digit() => self.parse_number(),
            _ => Err(self.error("expected a JSON value")),
        }
    }

    fn parse_literal(&mut self, literal: &str, value: JsonValue<'a>) -> Result<JsonValue<'a>, JsonParseError> {
        if !self.text[self.index..].starts_with(literal) {
            return Err(self.error("invalid JSON literal"));
        }
        self.index += literal.len();
        Ok(value)
    }

    fn parse_number(&mut self) -> Result<JsonValue<'a>, JsonParseError> {
        let start = self.index;
        if self.peek_byte() == Some(b'-') {
            self.index += 1;
        }
        let digits_start = self.index;
        while matches!(self.peek_byte(), Some(byte) if byte.is_ascii_digit()) {
            self.index += 1;
        }
        if self.index == digits_start {
            return Err(self.error("JSON number has no digits"));
        }
        if self.peek_byte() == Some(b'.') {
            self.index += 1;
            let fraction_start = self.index;
            while matches!(self.peek_byte(), Some(byte) if byte.is_ascii_digit()) {
                self.index += 1;
            }
            if self.index == fraction_start {
                return Err(self.error("JSON number fraction has no digits"));
            }
        }
        if matches!(self.peek_byte(), Some(b'e') | Some(b'E')) {
            self.index += 1;
            if matches!(self.peek_byte(), Some(b'+') | Some(b'-')) {
                self.index += 1;
            }
            let exponent_start = self.index;
            while matches!(self.peek_byte(), Some(byte) if byte.is_ascii_digit()) {
                self.index += 1;
            }
            if self.index == exponent_start {
                return Err(self.error("JSON number exponent has no digits"));
            }
        }
        Ok(JsonValue::Number(&self.text[start..self.index]))
    }

    fn parse_array(&mut self, depth: usize) -> Result<JsonValue<'a>, JsonParseError> {
        self.index += 1;
        let mut values = Vec::new();
        loop {
            self.skip_whitespace();
            match self.peek_byte() {
                Some(b']') => {
                    self.index += 1;
                    return Ok(JsonValue::Array(values));
                }
                None => return Err(self.error("unterminated JSON array")),
                _ => {}
            }
            values.push(self.parse_value(depth + 1)?);
            self.skip_whitespace();
            match self.peek_byte() {
                Some(b',') => self.index += 1,
                Some(b']') => {
                    self.index += 1;
                    return Ok(JsonValue::Array(values));
                }
                _ => return Err(self.error("expected , or ] in JSON array")),
            }
        }
    }

    fn parse_object(&mut self, depth: usize) -> Result<JsonValue<'a>, JsonParseError> {
        self.index += 1;
        let mut members = Vec::new();
        loop {
            self.skip_whitespace();
            match self.peek_byte() {
                Some(b'}') => {
                    self.index += 1;
                    return Ok(JsonValue::Object(members));
                }
                Some(b'"') => {}
                _ => return Err(self.error("expected a JSON object key")),
            }
            let key = self.parse_string()?;
            self.skip_whitespace();
            if self.peek_byte() != Some(b':') {
                return Err(self.error("expected : after JSON object key"));
            }
            self.index += 1;
            self.skip_whitespace();
            let value = self.parse_value(depth + 1)?;
            members.push((key, value));
            self.skip_whitespace();
            match self.peek_byte() {
                Some(b',') => self.index += 1,
                Some(b'}') => {
                    self.index += 1;
                    return Ok(JsonValue::Object(members));
                }
                _ => return Err(self.error("expected , or } in JSON object")),
            }
        }
    }

    fn parse_string(&mut self) -> Result<Cow<'a, str>, JsonParseError> {
        // The opening quote is known to be an ASCII byte, so every slice boundary
        // below is a character boundary of `self.text`.
        self.index += 1;
        let mut segment_start = self.index;
        let mut decoded: Option<String> = None;
        loop {
            let byte = match self.peek_byte() {
                Some(byte) => byte,
                None => return Err(self.error("unterminated JSON string")),
            };
            match byte {
                b'"' => {
                    let tail = &self.text[segment_start..self.index];
                    self.index += 1;
                    return Ok(match decoded {
                        Some(mut partial) => {
                            partial.push_str(tail);
                            Cow::Owned(partial)
                        }
                        None => Cow::Borrowed(tail),
                    });
                }
                b'\\' => {
                    // A segment always ends at an ASCII backslash, so the slice is
                    // valid UTF-8; everything before it is copied verbatim.
                    let segment = &self.text[segment_start..self.index];
                    let buffer = decoded.get_or_insert_with(String::new);
                    buffer.push_str(segment);
                    self.index += 1;
                    self.parse_escape_into(buffer)?;
                    segment_start = self.index;
                }
                other if other < 0x20 => {
                    return Err(self.error("raw control character in JSON string"));
                }
                _ => self.index += 1,
            }
        }
    }

    fn parse_escape_into(&mut self, buffer: &mut String) -> Result<(), JsonParseError> {
        let escape = self
            .peek_byte()
            .ok_or_else(|| self.error("truncated JSON string escape"))?;
        self.index += 1;
        let replacement = match escape {
            b'"' => '"',
            b'\\' => '\\',
            b'/' => '/',
            b'b' => '\u{0008}',
            b'f' => '\u{000C}',
            b'n' => '\n',
            b'r' => '\r',
            b't' => '\t',
            b'u' => return self.parse_unicode_escape_into(buffer),
            _ => return Err(self.error("unsupported JSON string escape")),
        };
        buffer.push(replacement);
        Ok(())
    }

    fn parse_unicode_escape_into(&mut self, buffer: &mut String) -> Result<(), JsonParseError> {
        let first = self.parse_hex_u16()?;
        let resolved = if (0xDC00..0xE000).contains(&first) {
            return Err(self.error("lone low surrogate in JSON string"));
        } else if !(0xD800..0xDC00).contains(&first) {
            char::from_u32(first as u32).ok_or_else(|| self.error("invalid Unicode scalar in JSON string"))?
        } else {
            let following = self.text.as_bytes().get(self.index..).unwrap_or(&[]);
            if following.first() != Some(&b'\\') || following.get(1) != Some(&b'u') {
                return Err(self.error("lone high surrogate in JSON string"));
            }
            self.index += 2;
            let second = self.parse_hex_u16()?;
            if !(0xDC00..0xE000).contains(&second) {
                return Err(self.error("missing low surrogate in JSON string"));
            }
            let combined = 0x1_0000
                + ((first as u32 - 0xD800) << 10)
                + (second as u32 - 0xDC00);
            char::from_u32(combined).ok_or_else(|| self.error("invalid surrogate pair in JSON string"))?
        };
        buffer.push(resolved);
        Ok(())
    }

    fn parse_hex_u16(&mut self) -> Result<u16, JsonParseError> {
        let mut value: u32 = 0;
        for _ in 0..4 {
            let byte = self.peek_byte().ok_or_else(|| self.error("truncated \\u escape"))?;
            let digit =
                (byte as char).to_digit(16).ok_or_else(|| self.error("invalid hex digit in \\u escape"))?;
            value = value * 16 + digit;
            self.index += 1;
        }
        Ok(value as u16)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_node_input_shape() {
        let document = parse_json(r#"{"action":"run","paths":["D:/a","D:/b"],"preview":false}"#)
            .expect("valid input");
        assert_eq!(document.get("action").and_then(JsonValue::as_str), Some("run"));
        assert_eq!(document.get("preview").and_then(JsonValue::as_bool), Some(false));
        let paths = document.get("paths").and_then(JsonValue::as_array).expect("array");
        assert_eq!(paths.iter().map(JsonValue::as_str).collect::<Vec<_>>(), vec![Some("D:/a"), Some("D:/b")]);
    }

    #[test]
    fn decodes_escapes_and_surrogate_pairs() {
        let document = parse_json(r#"{"name":"a\u0022b\\c","pair":"\uD83D\uDE00"}"#).expect("valid");
        assert_eq!(document.get("name").and_then(JsonValue::as_str), Some("a\"b\\c"));
        assert_eq!(document.get("pair").and_then(JsonValue::as_str), Some("\u{1F600}"));
    }

    #[test]
    fn translation_map_keys_are_deduplicated_and_sorted() {
        let document = parse_json(r#"{"002.png":"x","001.png":"y","002.png":"z"}"#).expect("valid");
        assert_eq!(document.sorted_unique_object_keys(), vec!["001.png".to_string(), "002.png".to_string()]);
    }

    #[test]
    fn non_object_documents_yield_no_keys() {
        for source in ["null", "[1,2]", "42", "\"text\"", "true"] {
            let document = parse_json(source).expect("valid JSON");
            assert_eq!(
                document.sorted_unique_object_keys(),
                Vec::<String>::new(),
                "source {source} must not look like a translation map"
            );
        }
    }

    #[test]
    fn rejects_malformed_documents() {
        for source in ["", "{\"a\"}", "[1,]", "\"raw\ncontrol\"", "123 456", "{\"a\":}"] {
            assert!(parse_json(source).is_err(), "expected rejection for {source:?}");
        }
    }

    #[test]
    fn bounded_nesting_rejects_a_runaway_array() {
        let deep = "[".repeat(MAX_JSON_NESTING_DEPTH + 8) + &"]".repeat(MAX_JSON_NESTING_DEPTH + 8);
        assert!(parse_json(&deep).is_err());
    }

    #[test]
    fn duplicate_keys_follow_json_parse_last_wins() {
        let document = parse_json(r#"{"preview":true,"preview":false}"#).expect("valid");
        assert_eq!(document.get("preview").and_then(JsonValue::as_bool), Some(false));
    }
}
