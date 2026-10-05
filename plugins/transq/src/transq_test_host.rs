//! A scriptable in-memory [`TransqHost`] for unit tests.
//!
//! It stands where `core.test.ts`'s literal fake runtime stood: it records the file
//! operations TransQ asks for, in the order it asks for them, so the ported tests
//! can assert the same `copy … -> …`, `remove …`, `move …` sequence. Directory
//! listings and the translation map come from the fixture tree instead of a real
//! filesystem, which is the point of the host boundary.

use std::collections::HashMap;

use crate::transq_contract::TransqRunEvent;
use crate::transq_host::{
    CheckpointDecision, DirectoryListing, HostCallError, PathKind, TransqHost,
};
use crate::transq_path::join_path;
use crate::transq_workspace_scan::TRANSLATION_MAP_FILE_NAME;

#[derive(Debug)]
pub struct VirtualTransqHost {
    listings: HashMap<String, DirectoryListing>,
    text_files: HashMap<String, String>,
    /// One-shot listing failures, keyed by the exact path asked for.
    pending_listing_failures: HashMap<String, Vec<String>>,
    /// One-shot mutation failures, keyed by the recorded operation prefix.
    pending_operation_failures: Vec<(String, String)>,
    pub operations: Vec<String>,
    /// Reads are kept apart from mutations so a test can assert the mutation order
    /// `core.test.ts:49-54` asserts, without the map file read in the middle.
    pub reads: Vec<String>,
    pub emitted_events: Vec<TransqRunEvent>,
    pub listed_paths: Vec<(String, bool)>,
    pub checkpoint_calls: usize,
    pub checkpoint_decision: CheckpointDecision,
}

impl VirtualTransqHost {
    pub fn new() -> Self {
        VirtualTransqHost {
            listings: HashMap::new(),
            text_files: HashMap::new(),
            pending_listing_failures: HashMap::new(),
            pending_operation_failures: Vec::new(),
            operations: Vec::new(),
            reads: Vec::new(),
            emitted_events: Vec::new(),
            listed_paths: Vec::new(),
            checkpoint_calls: 0,
            checkpoint_decision: CheckpointDecision::Continue,
        }
    }

    pub fn add_listing(&mut self, listing: DirectoryListing) {
        self.listings.insert(listing.path.clone(), listing);
    }

    /// The map file lives inside the result folder, exactly as the scan composes it.
    pub fn add_translation_map(&mut self, result_path: &str, content: &str) {
        self.text_files
            .insert(join_path(result_path, TRANSLATION_MAP_FILE_NAME), content.to_string());
    }

    pub fn remove_translation_map(&mut self, result_path: &str) {
        self.text_files.remove(&join_path(result_path, TRANSLATION_MAP_FILE_NAME));
    }

    pub fn fail_next_listing(&mut self, path: &str, message: &str) {
        self.pending_listing_failures.entry(path.to_string()).or_default().push(message.to_string());
    }

    /// Fails the next operation whose recorded line starts with `operation_prefix`,
    /// e.g. (`"copy D:/a/002.png"`, "EBUSY: target locked").
    pub fn fail_next_operation(&mut self, operation_prefix: &str, message: &str) {
        self.pending_operation_failures
            .push((operation_prefix.to_string(), message.to_string()));
    }

    pub fn failures_are_drained(&self) -> bool {
        self.pending_operation_failures.is_empty()
            && self.pending_listing_failures.values().all(Vec::is_empty)
    }

    pub fn listed_paths(&self) -> Vec<String> {
        self.listed_paths.iter().map(|(path, _)| path.clone()).collect()
    }

    pub fn stat_only_lookups(&self) -> usize {
        self.listed_paths.iter().filter(|(_, include_entries)| !*include_entries).count()
    }

    pub fn emitted_progress_messages(&self) -> Vec<String> {
        self.emitted_events.iter().map(|event| event.message.clone()).collect()
    }

    fn take_operation_failure(&mut self, operation: &str) -> Option<HostCallError> {
        let position = self
            .pending_operation_failures
            .iter()
            .position(|(prefix, _)| operation.starts_with(prefix.as_str()))?;
        let (_, message) = self.pending_operation_failures.remove(position);
        Some(HostCallError::new(message))
    }

    fn record(&mut self, operation: String) -> Result<(), HostCallError> {
        if let Some(error) = self.take_operation_failure(&operation) {
            self.operations.push(format!("failed {operation}"));
            return Err(error);
        }
        self.operations.push(operation);
        Ok(())
    }
}

impl Default for VirtualTransqHost {
    fn default() -> Self {
        Self::new()
    }
}

impl TransqHost for VirtualTransqHost {
    fn list_directory(&mut self, path: &str, include_entries: bool) -> Result<DirectoryListing, HostCallError> {
        self.listed_paths.push((path.to_string(), include_entries));
        let injected = self.pending_listing_failures.get_mut(path).and_then(Vec::pop);
        if let Some(message) = injected {
            if self.pending_listing_failures.get(path).is_none_or(Vec::is_empty) {
                self.pending_listing_failures.remove(path);
            }
            return Err(HostCallError::new(message));
        }

        // Unknown paths come back as `Missing` rather than an error: `platform.ts`
        // turned a failed `lstat` into "not a directory", not into a thrown error.
        let listing = match self.listings.get(path) {
            Some(found) => DirectoryListing {
                path: path.to_string(),
                kind: found.kind,
                entries: if include_entries { found.entries.clone() } else { Vec::new() },
            },
            None => DirectoryListing {
                path: path.to_string(),
                kind: PathKind::Missing,
                entries: Vec::new(),
            },
        };
        Ok(listing)
    }

    fn read_text_file(&mut self, path: &str) -> Result<String, HostCallError> {
        self.reads.push(path.to_string());
        match self.text_files.get(path) {
            Some(content) => Ok(content.clone()),
            None => Err(HostCallError::new(format!("ENOENT: no such file or directory, open '{path}'"))),
        }
    }

    fn copy_file(&mut self, source_path: &str, destination_path: &str) -> Result<(), HostCallError> {
        self.record(format!("copy {source_path} -> {destination_path}"))
    }

    fn move_directory(&mut self, source_path: &str, destination_path: &str) -> Result<(), HostCallError> {
        self.record(format!("move {source_path} -> {destination_path}"))
    }

    fn remove_path(&mut self, path: &str) -> Result<(), HostCallError> {
        self.record(format!("remove {path}"))
    }

    fn emit_event(&mut self, event: &TransqRunEvent) {
        self.emitted_events.push(event.clone());
    }

    fn checkpoint(&mut self) -> CheckpointDecision {
        self.checkpoint_calls += 1;
        self.checkpoint_decision
    }
}
