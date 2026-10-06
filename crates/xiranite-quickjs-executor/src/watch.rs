//! The library watch the host owns for a run's Findz engine (ADR-0077 decision 5).
//!
//! ## Why this file exists at all
//!
//! `findz` used to watch its library with `@parcel/watcher` inside a Bun worker
//! (`packages/nodes/findz/src/findz-worker.ts`, deleted). That placement was never accidental: a
//! scan can outlive any single request, so the watch had to live somewhere that could wait. Under
//! ADR-0074 §5 a face may not hold a second engine, and a QuickJS realm has no timers at all — so the
//! only place left for a subscription is the host, next to the sidecar it feeds.
//!
//! ## Why the rules are copied rather than reinvented
//!
//! `packages/nodes/findz/src/watcher-service.ts` states the product's semantics: latest event per
//! path wins, a 250 ms quiet window rescheduled by every event, a `(size, mtimeMs)` stability check
//! before a change is believed, `degraded` plus exactly one `scan.reconcile` when delivery fails, and
//! an idempotent close. A second implementation of "when is a file done being written" would be a
//! second authority, and this node has already been called out twice today for two authorities over
//! one fact.
//!
//! ## Why delivery does not happen on this thread
//!
//! A response answers the request written before it — `crate::sidecar`'s pairing rule, held by the
//! table lock across write and read. A second writer on the same child would break that silently, so
//! this module never touches the pipe: it fills a buffer, and the holder drains it inside its own
//! round. One writer per child, and no query can read a state the watch already knew about.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use crossbeam_channel::unbounded;
use notify::event::{ModifyKind, MetadataKind};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};

/// How long a library must stay quiet before a batch of changes is believed.
pub(crate) const QUIET_WINDOW: Duration = Duration::from_millis(250);

/// How long the watch thread blocks before re-checking, while nothing is pending. Bounded so
/// `close()` is prompt without turning the idle thread into a spin.
const IDLE_POLL: Duration = Duration::from_millis(100);

/// The change type the Findz core's envelope speaks (`native/findz-go`'s `watcherChange.Type`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ChangeKind {
    Create,
    Update,
    Delete,
}

impl ChangeKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Update => "update",
            Self::Delete => "delete",
        }
    }
}

/// One path the watch is waiting to believe.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PendingChange {
    pub(crate) path: PathBuf,
    pub(crate) kind: ChangeKind,
}

/// A size-and-mtime reading, the pair the node's service compares.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Observation {
    size: u64,
    mtime_ms: u64,
}

fn observe(path: &Path) -> Option<Observation> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.is_dir() {
        // Directories move for reasons that say nothing about an archive; the core indexes files.
        return None;
    }
    let age = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    Some(Observation {
        size: meta.len(),
        mtime_ms: u64::try_from(age).unwrap_or(u64::MAX),
    })
}

/// The state machine, with the clock and the filesystem reached only through explicit calls, so the
/// rules can be tested without waiting for anything.
#[derive(Debug)]
pub(crate) struct WatchState {
    changes: HashMap<PathBuf, PendingChange>,
    observations: HashMap<PathBuf, Observation>,
    ready: Vec<PendingChange>,
    quiet_after: Option<Instant>,
    reconcile_queued: bool,
    degraded: bool,
    /// A backend error the holder has not reported yet (see `note_stream_error`).
    stream_error: bool,
    closed: bool,
}

impl WatchState {
    fn new() -> Self {
        Self {
            changes: HashMap::new(),
            observations: HashMap::new(),
            ready: Vec::new(),
            quiet_after: None,
            reconcile_queued: false,
            degraded: false,
            stream_error: false,
            closed: false,
        }
    }

    /// Latest event per path wins and voids any earlier reading of it — the two lines `queue()`
    /// performs in `watcher-service.ts`.
    pub(crate) fn queue(&mut self, events: Vec<PendingChange>, now: Instant) {
        if self.closed {
            return;
        }
        let mut latest: HashMap<PathBuf, PendingChange> = HashMap::new();
        for event in events {
            latest.insert(event.path.clone(), event);
        }
        for (path, change) in latest {
            self.observations.remove(&path);
            self.changes.insert(path, change);
        }
        self.quiet_after = Some(now + QUIET_WINDOW);
    }

    /// Once the quiet window has elapsed, hand back the changes that look stable.
    ///
    /// A path whose `(size, mtimeMs)` differs from the previous pass is kept, re-observed and waited
    /// on again — that is what stops a multi-megabyte archive from being indexed half-written.
    pub(crate) fn flush_if_quiet(&mut self, now: Instant) {
        if self.closed || self.changes.is_empty() {
            self.quiet_after = None;
            return;
        }
        let Some(deadline) = self.quiet_after else {
            return;
        };
        if now < deadline {
            return;
        }
        let mut ready = Vec::new();
        let mut unstable = Vec::new();
        let mut vanished = Vec::new();
        for change in self.changes.values() {
            if change.kind == ChangeKind::Delete {
                self.observations.remove(&change.path);
                ready.push(change.clone());
                continue;
            }
            let Some(current) = observe(&change.path) else {
                // The path went away between the event and the read. Report it as a delete: keeping
                // the observation would pin the entry, and the core's `delete` branch is exactly the
                // handler for a row whose file is gone.
                self.observations.remove(&change.path);
                vanished.push(PendingChange {
                    path: change.path.clone(),
                    kind: ChangeKind::Delete,
                });
                continue;
            };
            match self.observations.get(&change.path) {
                Some(previous) if *previous == current => {
                    self.observations.remove(&change.path);
                    ready.push(change.clone());
                }
                _ => {
                    self.observations.insert(change.path.clone(), current);
                    unstable.push(change.clone());
                }
            }
        }
        ready.extend(vanished);
        if unstable.is_empty() {
            self.changes.clear();
            self.quiet_after = None;
        } else {
            // Re-arm the window for what is still moving, keeping only the unsettled paths.
            self.changes.clear();
            for change in unstable {
                self.changes.insert(change.path.clone(), change);
            }
            self.quiet_after = Some(now + QUIET_WINDOW);
        }
        self.ready.extend(ready);
    }

    /// Notes a delivered batch. `true` means the library had been reported `degraded`, so the caller
    /// owes it a `watcher.set_health healthy` — without that, one transient failure would leave the
    /// faces reporting a broken watcher after the feed recovered.
    pub(crate) fn delivered(&mut self) -> bool {
        let was_degraded = self.degraded;
        self.degraded = false;
        self.reconcile_queued = false;
        was_degraded
    }

    /// `true` the first time a library degrades after a delivery: that is when the host owes it a
    /// `scan.reconcile`, and only then — a wedged filesystem must not queue reconciles forever.
    pub(crate) fn degrade(&mut self) -> bool {
        if self.closed {
            return false;
        }
        self.degraded = true;
        if self.reconcile_queued {
            return false;
        }
        self.reconcile_queued = true;
        true
    }

    /// Notes that the watch backend itself failed.
    ///
    /// The node's service did the same thing with the same reason: a subscription error says the
    /// events stopped, which is exactly what `degraded` means to the UI — and the faces cannot learn
    /// it any other way, because a silent stop is indistinguishable from a quiet library.
    pub(crate) fn note_stream_error(&mut self) {
        if !self.closed {
            self.stream_error = true;
        }
    }

    /// Takes what the holder must report: the batch, and whether a backend error is also pending.
    /// `None` when there is nothing to say.
    pub(crate) fn take_signal(&mut self) -> Option<(Vec<PendingChange>, bool)> {
        let error = self.stream_error;
        self.stream_error = false;
        if error {
            let changes = std::mem::take(&mut self.ready);
            return Some((changes, true));
        }
        if self.ready.is_empty() {
            return None;
        }
        Some((std::mem::take(&mut self.ready), false))
    }

    pub(crate) fn close(&mut self) {
        self.closed = true;
        self.changes.clear();
        self.observations.clear();
        self.ready.clear();
        self.stream_error = false;
        self.quiet_after = None;
    }
}

/// A live watch for one library of one run. Dropping it stops the thread and unsubscribes.
pub(crate) struct LibraryWatch {
    library_id: String,
    state: Arc<Mutex<WatchState>>,
    /// Held so the subscription is cancelled when this goes away with the run.
    watcher: RecommendedWatcher,
    stop: crossbeam_channel::Sender<()>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl LibraryWatch {
    /// Watches `root` recursively. A subscription failure is returned for the caller to report as
    /// `degraded`, which is the same rule the worker followed: an open that could not start a watch
    /// still had to answer.
    pub(crate) fn start(library_id: &str, root: &Path) -> notify::Result<Self> {
        let state = Arc::new(Mutex::new(WatchState::new()));
        let (events_tx, events_rx) = unbounded::<Vec<PendingChange>>();
        let (stop_tx, stop_rx) = unbounded::<()>();
        let thread_state = Arc::clone(&state);

        let error_state = Arc::clone(&state);
        let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| match result {
            Ok(event) => {
                let changes = translate(&event.kind, &event.paths);
                if !changes.is_empty() {
                    let _ = events_tx.send(changes);
                }
            }
            // An error names no path, so there is nothing to queue — but dropping it here would
            // leave the library reporting `healthy` while its events have stopped, which is the
            // failure mode `watcher-service.ts` mapped to `degrade()` + one reconcile. Park it on
            // the state; the holder reports it on its own thread, since this one cannot write.
            Err(_) => lock(&error_state).note_stream_error(),
        })?;
        watcher.watch(root, RecursiveMode::Recursive)?;

        let thread = std::thread::spawn(move || loop {
            if stop_rx.try_recv().is_ok() {
                return;
            }
            // Wait out the quiet window if one is armed; otherwise idle so `close` stays prompt.
            let wait = {
                let held = lock(&thread_state);
                match held.quiet_after {
                    Some(deadline) => deadline.saturating_duration_since(Instant::now()),
                    None => IDLE_POLL,
                }
            };
            match events_rx.recv_timeout(wait) {
                Ok(batch) => {
                    lock(&thread_state).queue(batch, Instant::now());
                    continue;
                }
                Err(crossbeam_channel::RecvTimeoutError::Timeout) => {}
                Err(crossbeam_channel::RecvTimeoutError::Disconnected) => return,
            }
            lock(&thread_state).flush_if_quiet(Instant::now());
        });

        Ok(Self {
            library_id: library_id.to_string(),
            state,
            watcher,
            stop: stop_tx,
            thread: Some(thread),
        })
    }

    pub(crate) fn library_id(&self) -> &str {
        &self.library_id
    }

    /// Takes what this watch owes the engine: the coalesced batch, and whether a backend error is
    /// also pending. `None` means there is nothing to say. Called from the holder's thread, which is
    /// the only thread allowed to write to the child.
    pub(crate) fn take_signal(&self) -> Option<(Vec<PendingChange>, bool)> {
        lock(&self.state).take_signal()
    }

    /// Notes that a batch reached the engine; `true` = also report the library healthy again.
    pub(crate) fn delivered(&self) -> bool {
        lock(&self.state).delivered()
    }

    /// Notes that delivery failed. `true` means the caller must also queue one `scan.reconcile`.
    pub(crate) fn degrade(&self) -> bool {
        lock(&self.state).degrade()
    }
}

impl Drop for LibraryWatch {
    fn drop(&mut self) {
        // The subscription and its thread belong to the run that opened the library: an engine that
        // is gone must not keep receiving events for it, and a thread must not outlive its handle.
        let _ = self.stop.send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        lock(&self.state).close();
        // `watcher` drops here, which unsubscribes.
        let _ = &self.watcher;
    }
}

/// notify's event kinds into the three types the Findz core names.
fn translate(kind: &EventKind, paths: &[PathBuf]) -> Vec<PendingChange> {
    let change = match kind {
        EventKind::Create(_) => ChangeKind::Create,
        EventKind::Remove(_) => ChangeKind::Delete,
        // Reading a file or changing its permissions moves no content, and the core would re-index an
        // archive for nothing. `Metadata(WriteTime)` is kept: on the backends that classify finely it
        // is the tail of a real write, and on the ones that do not, the event arrives as `Any`.
        EventKind::Modify(ModifyKind::Metadata(MetadataKind::AccessTime | MetadataKind::Permissions)) => {
            return Vec::new();
        }
        EventKind::Modify(ModifyKind::Name(_)) | EventKind::Modify(_) => ChangeKind::Update,
        // Access and metadata moves say nothing about an archive's contents; `Other` says nothing at
        // all. The core would re-read the archive for no reason.
        _ => return Vec::new(),
    };
    paths
        .iter()
        .filter(|path| !path.is_dir())
        .map(|path| PendingChange {
            path: path.clone(),
            kind: change,
        })
        .collect()
}

fn lock<T>(value: &Arc<Mutex<T>>) -> MutexGuard<'_, T> {
    value.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
#[path = "watch/tests.rs"]
mod tests;
