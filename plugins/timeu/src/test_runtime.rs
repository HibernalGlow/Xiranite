//! The fake host used by the core contract tests: the Rust form of
//! `fakeRuntime` (`packages/nodes/timeu/src/core.test.ts:54-87`).
//!
//! It is a test-only module shared by `timeu_core`'s behavioural tests and the
//! plugin entry-point tests, so both run against the same filesystem semantics:
//! nothing resolves a path, `stat` never fails, `readText` answers `None` for an
//! unknown file, and `setTimes` records its calls instead of touching an inode.

#![cfg(test)]

use std::cell::RefCell;
use std::collections::HashMap;

use serde_json::{Value, json};

use crate::timeu_core::run_timeu_into_result;
use crate::timeu_input::TimeuInput;
use crate::timeu_model::{
    TimeuDirectoryEntry, TimeuPathInfo, TimeuRunEvent, TimeuRunResult, TimeuTimestampRecord,
};
use crate::timeu_runtime::{
    CollectingTimeuEventSink, TimeuCheckpointOutcome, TimeuHostError, TimeuRuntime,
};

/// `new Date("2026-01-01T00:00:00.000Z")`, the clock `core.test.ts:82` used.
pub const FAKE_NOW_MS: f64 = 1_767_225_600_000.0;
pub const FAKE_NOW_ISO: &str = "2026-01-01T00:00:00.000Z";
pub const RECORD_PATH: &str = "/root/timeu.json";

/// `stamp(atimeMs, mtimeMs)` from `core.test.ts:89-91`: ctime is `mtime + 1`,
/// birthtime is `mtime + 2`.
pub fn stamp(atime_ms: f64, mtime_ms: f64) -> [f64; 4] {
    [atime_ms, mtime_ms, mtime_ms + 1.0, mtime_ms + 2.0]
}

/// A record document, read the way `loadTimestampRecords` reads it.
pub fn records_from(document: &Value) -> Vec<TimeuTimestampRecord> {
    document
        .as_array()
        .expect("record array")
        .iter()
        .filter_map(TimeuTimestampRecord::from_json)
        .collect()
}

pub fn record(path: &str, atime_ms: i64, mtime_ms: i64, backed_up_at: &str) -> Value {
    json!({
        "path": path,
        "atimeMs": atime_ms,
        "mtimeMs": mtime_ms,
        "ctimeMs": mtime_ms + 1,
        "birthtimeMs": mtime_ms + 2,
        "backedUpAt": backed_up_at,
    })
}

pub struct FakeTimeuRuntime {
    files: HashMap<String, [f64; 4]>,
    directories: HashMap<String, Vec<String>>,
    reads: HashMap<String, String>,
    writes: RefCell<HashMap<String, String>>,
    ensured_directories: RefCell<Vec<String>>,
    applied_times: RefCell<Vec<(String, f64, f64)>>,
    set_times_failures: HashMap<String, String>,
    list_failures: HashMap<String, String>,
    listings: RefCell<Vec<String>>,
    now_ms: f64,
    cancel_at_checkpoint: Option<usize>,
    checkpoints: RefCell<usize>,
}

impl FakeTimeuRuntime {
    pub fn new() -> Self {
        Self {
            files: HashMap::new(),
            directories: HashMap::new(),
            reads: HashMap::new(),
            writes: RefCell::new(HashMap::new()),
            ensured_directories: RefCell::new(Vec::new()),
            applied_times: RefCell::new(Vec::new()),
            set_times_failures: HashMap::new(),
            list_failures: HashMap::new(),
            listings: RefCell::new(Vec::new()),
            now_ms: FAKE_NOW_MS,
            cancel_at_checkpoint: None,
            checkpoints: RefCell::new(0),
        }
    }

    pub fn with_file(mut self, path: &str, atime_ms: f64, mtime_ms: f64) -> Self {
        self.files.insert(path.to_string(), stamp(atime_ms, mtime_ms));
        self
    }

    pub fn with_directory(mut self, path: &str, children: &[&str]) -> Self {
        self.directories
            .insert(path.to_string(), children.iter().map(|child| child.to_string()).collect());
        self
    }

    pub fn with_read(mut self, path: &str, text: &str) -> Self {
        self.reads.insert(path.to_string(), text.to_string());
        self
    }

    pub fn with_stored_records(self, path: &str, documents: &[Value]) -> Self {
        let text = crate::timeu_core::dump_timestamp_records(&records_from(&Value::Array(documents.to_vec())));
        self.with_read(path, &text)
    }

    pub fn with_set_times_failure(mut self, path: &str, message: &str) -> Self {
        self.set_times_failures.insert(path.to_string(), message.to_string());
        self
    }

    /// A directory that `stat` reports but whose listing fails, which is the only
    /// way `core.ts:155` can throw.
    pub fn with_list_failure(mut self, path: &str, message: &str) -> Self {
        self.list_failures.insert(path.to_string(), message.to_string());
        self
    }

    pub fn cancelled_at_checkpoint(mut self, index: usize) -> Self {
        self.cancel_at_checkpoint = Some(index);
        self
    }

    /// `options.writes` in the TypeScript fake, ordered by path.
    pub fn writes(&self) -> Vec<(String, String)> {
        let mut written: Vec<(String, String)> = self
            .writes
            .borrow()
            .iter()
            .map(|(path, content)| (path.clone(), content.clone()))
            .collect();
        written.sort_by(|left, right| left.0.cmp(&right.0));
        written
    }

    /// `applied` in the TypeScript restore case.
    pub fn applied_times(&self) -> Vec<(String, f64, f64)> {
        self.applied_times.borrow().clone()
    }

    pub fn listing_paths(&self) -> Vec<String> {
        self.listings.borrow().clone()
    }

    pub fn checkpoint_count(&self) -> usize {
        *self.checkpoints.borrow()
    }

    pub fn ensured_directories(&self) -> Vec<String> {
        self.ensured_directories.borrow().clone()
    }
}

impl TimeuRuntime for FakeTimeuRuntime {
    fn path_info(&self, path: &str) -> Result<TimeuPathInfo, TimeuHostError> {
        // The fake resolves nothing, exactly like `core.test.ts:64-75`.
        if let Some([atime_ms, mtime_ms, ctime_ms, birthtime_ms]) = self.files.get(path) {
            return Ok(TimeuPathInfo {
                path: path.to_string(),
                exists: true,
                is_file: true,
                is_directory: false,
                atime_ms: *atime_ms,
                mtime_ms: *mtime_ms,
                ctime_ms: *ctime_ms,
                birthtime_ms: *birthtime_ms,
            });
        }
        if self.directories.contains_key(path) {
            return Ok(TimeuPathInfo {
                path: path.to_string(),
                exists: true,
                is_file: false,
                is_directory: true,
                atime_ms: 0.0,
                mtime_ms: 0.0,
                ctime_ms: 0.0,
                birthtime_ms: 0.0,
            });
        }
        Ok(TimeuPathInfo::missing(path))
    }

    fn list_directory(&self, path: &str) -> Result<Vec<TimeuDirectoryEntry>, TimeuHostError> {
        self.listings.borrow_mut().push(path.to_string());
        if let Some(message) = self.list_failures.get(path) {
            return Err(TimeuHostError::new(message.clone()));
        }
        let children = self.directories.get(path).ok_or_else(|| {
            TimeuHostError::new(format!("ENOENT: no such file or directory, scandir '{path}'"))
        })?;
        Ok(children
            .iter()
            .map(|child| TimeuDirectoryEntry {
                name: child.rsplit(['/', '\\']).next().unwrap_or(child).to_string(),
                path: child.clone(),
                is_file: self.files.contains_key(child),
                is_directory: self.directories.contains_key(child),
            })
            .collect())
    }

    fn read_text(&self, path: &str) -> Option<String> {
        self.reads.get(path).cloned()
    }

    fn write_text(&self, path: &str, content: &str) -> Result<(), TimeuHostError> {
        self.writes
            .borrow_mut()
            .insert(path.to_string(), content.to_string());
        Ok(())
    }

    fn ensure_directory(&self, path: &str) -> Result<(), TimeuHostError> {
        self.ensured_directories.borrow_mut().push(path.to_string());
        Ok(())
    }

    fn set_times(&self, path: &str, atime_ms: f64, mtime_ms: f64) -> Result<(), TimeuHostError> {
        if let Some(message) = self.set_times_failures.get(path) {
            return Err(TimeuHostError::new(message.clone()));
        }
        self.applied_times
            .borrow_mut()
            .push((path.to_string(), atime_ms, mtime_ms));
        Ok(())
    }

    fn now_epoch_ms(&self) -> Result<f64, TimeuHostError> {
        Ok(self.now_ms)
    }

    fn checkpoint(&self) -> Result<TimeuCheckpointOutcome, TimeuHostError> {
        let mut count = self.checkpoints.borrow_mut();
        *count += 1;
        if self.cancel_at_checkpoint == Some(*count) {
            return Ok(TimeuCheckpointOutcome::Cancelled {
                message: "Operation cancelled.".to_string(),
            });
        }
        Ok(TimeuCheckpointOutcome::Continue)
    }
}

/// `fakeRuntime`'s `join`/`dirname` (`core.test.ts:83-84`) are simple POSIX-ish
/// text helpers, so the trait's pure defaults already produce the shapes the
/// TypeScript fake returned for `/root/...` paths.

pub fn run(runtime: &FakeTimeuRuntime, input: Value) -> TimeuRunResult {
    let mut sink = CollectingTimeuEventSink::new();
    run_with_sink(runtime, input, &mut sink)
}

pub fn run_with_sink(
    runtime: &FakeTimeuRuntime,
    input: Value,
    sink: &mut CollectingTimeuEventSink,
) -> TimeuRunResult {
    run_timeu_into_result(&TimeuInput::from_json(&input), runtime, sink)
}

pub fn data_json(result: &TimeuRunResult) -> Value {
    result.data.as_ref().expect("result data").to_json()
}

/// The written record document, decoded back into JSON values.
pub fn written_records(runtime: &FakeTimeuRuntime, path: &str) -> Vec<Value> {
    let written = runtime
        .writes()
        .into_iter()
        .find(|(written_path, _)| written_path == path)
        .unwrap_or_else(|| panic!("no write to {path}"));
    serde_json::from_str(&written.1).expect("record json")
}

/// Events collected by a sink, as `(percent, message)`.
pub fn event_pairs(sink: &CollectingTimeuEventSink) -> Vec<(Option<f64>, String)> {
    sink.events
        .iter()
        .map(|event: &TimeuRunEvent| (event.progress, event.message.clone()))
        .collect()
}
