//! Minimal JSON text writer.
//!
//! Only what the TransQ contract needs: objects, arrays, strings, integers and
//! booleans, with the same escaping rules as `JSON.stringify` so the payloads the
//! React layer already renders do not change shape when the node moves to Rust.

/// Escapes one string exactly like `JSON.stringify` does for the characters the
/// TransQ payloads can contain (path separators, quotes, backslashes, control
/// characters, and the two non-ASCII separators Windows users can type).
pub fn write_json_string(output: &mut String, value: &str) {
    output.push('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\u{0008}' => output.push_str("\\b"),
            '\u{000C}' => output.push_str("\\f"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            // `JSON.stringify` emits `\u00XX` for the remaining C0 controls and
            // `\u2028`/`\u2029` are escaped by neither, so they pass through.
            other if (other as u32) < 0x20 => {
                output.push_str(&format!("\\u{:04x}", other as u32));
            }
            other => output.push(other),
        }
    }
    output.push('"');
}

/// Convenience for the handful of stand-alone strings in host requests.
pub fn json_string_literal(value: &str) -> String {
    let mut output = String::new();
    write_json_string(&mut output, value);
    output
}

struct Frame {
    is_array: bool,
    has_member: bool,
}

/// Stack-based writer: it owns comma placement so callers only describe structure.
pub struct JsonWriter {
    buffer: String,
    frames: Vec<Frame>,
}

impl JsonWriter {
    pub fn new() -> Self {
        Self { buffer: String::new(), frames: Vec::new() }
    }

    pub fn begin_object(&mut self) {
        self.before_member();
        self.buffer.push('{');
        self.frames.push(Frame { is_array: false, has_member: false });
    }

    pub fn end_object(&mut self) {
        debug_assert!(self.frames.pop().is_none_or(|frame| !frame.is_array));
        self.buffer.push('}');
        self.after_member();
    }

    pub fn begin_array(&mut self) {
        self.before_member();
        self.buffer.push('[');
        self.frames.push(Frame { is_array: true, has_member: false });
    }

    pub fn end_array(&mut self) {
        debug_assert!(self.frames.pop().is_none_or(|frame| frame.is_array));
        self.buffer.push(']');
        self.after_member();
    }

    /// Keys are written as `write_value` calls in pairs with their value, so the
    /// member bookkeeping happens once per pair.
    pub fn key(&mut self, name: &str) {
        debug_assert!(self.frames.last().is_none_or(|frame| !frame.is_array));
        self.before_member();
        write_json_string(&mut self.buffer, name);
        self.buffer.push(':');
    }

    pub fn value_str(&mut self, value: &str) {
        self.before_member();
        write_json_string(&mut self.buffer, value);
        self.after_member();
    }

    pub fn value_i64(&mut self, value: i64) {
        self.before_member();
        self.buffer.push_str(&value.to_string());
        self.after_member();
    }

    pub fn value_usize(&mut self, value: usize) {
        self.before_member();
        self.buffer.push_str(&value.to_string());
        self.after_member();
    }

    pub fn value_bool(&mut self, value: bool) {
        self.before_member();
        self.buffer.push_str(if value { "true" } else { "false" });
        self.after_member();
    }

    /// For already-serialized sub-documents, the one place raw text may enter.
    pub fn value_raw(&mut self, value: &str) {
        self.before_member();
        self.buffer.push_str(value);
        self.after_member();
    }

    pub fn string(self) -> String {
        debug_assert!(self.frames.is_empty(), "unbalanced JSON writer frame stack");
        self.buffer
    }

    fn before_member(&mut self) {
        if let Some(frame) = self.frames.last_mut() {
            if frame.has_member {
                self.buffer.push(',');
            }
        }
    }

    fn after_member(&mut self) {
        if let Some(frame) = self.frames.last_mut() {
            frame.has_member = true;
        }
    }
}

impl Default for JsonWriter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_nested_objects_without_stray_commas() {
        let mut writer = JsonWriter::new();
        writer.begin_object();
        writer.key("message");
        writer.value_str("ok");
        writer.key("items");
        writer.begin_array();
        writer.begin_object();
        writer.key("id");
        writer.value_usize(7);
        writer.key("flags");
        writer.begin_array();
        writer.end_array();
        writer.end_object();
        writer.end_array();
        writer.end_object();

        assert_eq!(writer.string(), "{\"message\":\"ok\",\"items\":[{\"id\":7,\"flags\":[]}]}");
    }

    #[test]
    fn escapes_like_json_stringify() {
        assert_eq!(json_string_literal("a\"b\\c"), "\"a\\\"b\\\\c\"");
        assert_eq!(json_string_literal("line\nnext\ttab"), "\"line\\nnext\\ttab\"");
        assert_eq!(json_string_literal("D:\\translation\\chapter"), "\"D:\\\\translation\\\\chapter\"");
        assert_eq!(json_string_literal("\u{0001}"), "\"\\u0001\"");
    }

    #[test]
    fn top_level_array_members_are_comma_separated() {
        let mut writer = JsonWriter::new();
        writer.begin_array();
        writer.value_str("one");
        writer.value_str("two");
        writer.end_array();

        assert_eq!(writer.string(), "[\"one\",\"two\"]");
    }
}
