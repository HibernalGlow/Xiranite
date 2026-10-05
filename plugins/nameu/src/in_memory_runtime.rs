//! Test double that mirrors `fakeRuntime` and `infoFor` from
//! `packages/nodes/nameu/src/core.test.ts:72-95`, so the ported assertions mean
//! the same thing they meant in TypeScript.

use std::collections::BTreeMap;

use crate::contract::{
    NameuCheckpointRequest, NameuCheckpointStatus, NameuDirEntry, NameuPathInfo, NameuRunEvent,
};
use crate::path::{basename_of, dirname_of, join_paths};
use crate::plan::{NameuRuntime, NameuRuntimeError, NameuRuntimeResult};

/// Every directory key is a directory that exists; files are discovered through
/// the listings, exactly like `infoFor`.
#[derive(Debug, Default)]
pub(crate) struct InMemoryNameuRuntime {
    pub(crate) dirs: BTreeMap<String, Vec<NameuDirEntry>>,
    pub(crate) renames: Vec<(String, String)>,
    pub(crate) set_times: Vec<(String, f64, f64)>,
    pub(crate) events: Vec<NameuRunEvent>,
    pub(crate) checkpoints: Vec<NameuCheckpointRequest>,
    /// Host calls that should fail, used for the TypeScript `catch` branches.
    pub(crate) failing_paths: Vec<String>,
    pub(crate) checkpoint_status: NameuCheckpointStatus,
    /// Cancels only inside the named checkpoint phase, so a scan can finish
    /// before the write loop is stopped.
    pub(crate) cancel_during_phase: Option<String>,
}

/// `atimeMs`/`mtimeMs` reported by the TypeScript fake for anything that exists.
const FAKE_ACCESS_TIME_MS: f64 = 1000.0;
const FAKE_MODIFY_TIME_MS: f64 = 2000.0;

impl InMemoryNameuRuntime {
    /// `dirs`: `(directory path, [(entry name, entry path, isFile)])`.
    pub(crate) fn new(dirs: &[(&str, &[(&str, &str, bool)])]) -> Self {
        Self {
            dirs: dirs
                .iter()
                .map(|(directory, entries)| {
                    (
                        (*directory).to_string(),
                        entries
                            .iter()
                            .map(|(name, path, is_file)| NameuDirEntry {
                                name: (*name).to_string(),
                                path: (*path).to_string(),
                                is_file: *is_file,
                                is_directory: !*is_file,
                            })
                            .collect(),
                    )
                })
                .collect(),
            ..Self::default()
        }
    }

    fn fail_if_requested(&self, path: &str) -> NameuRuntimeResult<()> {
        if self.failing_paths.iter().any(|failing| failing.as_str() == path) {
            return Err(NameuRuntimeError::Failure(format!("host refusal: {path}")));
        }
        Ok(())
    }
}

impl NameuRuntime for InMemoryNameuRuntime {
    fn path_info(&mut self, path: &str) -> NameuRuntimeResult<NameuPathInfo> {
        self.fail_if_requested(path)?;
        if self.dirs.contains_key(path) {
            return Ok(NameuPathInfo {
                path: path.to_string(),
                exists: true,
                is_file: false,
                is_directory: true,
                atime_ms: FAKE_ACCESS_TIME_MS,
                mtime_ms: FAKE_MODIFY_TIME_MS,
            });
        }
        for entries in self.dirs.values() {
            if let Some(entry) = entries.iter().find(|entry| entry.path == path) {
                return Ok(NameuPathInfo {
                    path: path.to_string(),
                    exists: true,
                    is_file: entry.is_file,
                    is_directory: entry.is_directory,
                    atime_ms: FAKE_ACCESS_TIME_MS,
                    mtime_ms: FAKE_MODIFY_TIME_MS,
                });
            }
        }
        Ok(NameuPathInfo::missing(path))
    }

    fn list_dir(&mut self, path: &str) -> NameuRuntimeResult<Vec<NameuDirEntry>> {
        self.fail_if_requested(path)?;
        Ok(self.dirs.get(path).cloned().unwrap_or_default())
    }

    fn rename(&mut self, from: &str, to: &str) -> NameuRuntimeResult<()> {
        self.fail_if_requested(from)?;
        self.renames.push((from.to_string(), to.to_string()));
        Ok(())
    }

    fn set_times(&mut self, path: &str, atime_ms: f64, mtime_ms: f64) -> NameuRuntimeResult<()> {
        self.fail_if_requested(path)?;
        self.set_times.push((path.to_string(), atime_ms, mtime_ms));
        Ok(())
    }

    fn join(&self, parts: &[&str]) -> String {
        join_paths(parts)
    }

    fn dirname(&self, path: &str) -> String {
        dirname_of(path)
    }

    fn basename(&self, path: &str) -> String {
        basename_of(path)
    }

    fn emit(&mut self, event: &NameuRunEvent) -> NameuRuntimeResult<()> {
        self.events.push(event.clone());
        Ok(())
    }

    fn checkpoint(&mut self, request: &NameuCheckpointRequest) -> NameuRuntimeResult<NameuCheckpointStatus> {
        self.checkpoints.push(request.clone());
        let cancelled_in_phase = self
            .cancel_during_phase
            .as_deref()
            .is_some_and(|phase| phase == request.phase);
        if cancelled_in_phase || self.checkpoint_status == NameuCheckpointStatus::Cancelled {
            return Ok(NameuCheckpointStatus::Cancelled);
        }
        Ok(NameuCheckpointStatus::Continue)
    }
}
