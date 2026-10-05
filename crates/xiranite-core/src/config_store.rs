//! The host's own documents: one locked, durable read-modify-write.
//!
//! ## Why this lives in the core and not in a realm bundle
//!
//! `packages/config/src/node.ts` used to answer this with npm `proper-lockfile` (a lockfile plus
//! `graceful-fs` and `signal-exit`) and `write-file-atomic` (a temp file plus `worker_threads`). Both are
//! Node-side machinery: `graceful-fs` opens by monkey-patching properties on the `fs` module, and the realm's
//! `fs` shim has no writable properties, so a bundle carrying that closure dies at load with
//! `no setter for property` (measured on `linku`; `docs/migration/quickjs-substrate-evaluation.md` §15.8).
//! Locking and durability are also exactly what ADR-0074 §2 says a realm must not implement for itself —
//! they are host behaviour with a cross-process witness on disk.
//!
//! So the primitives are here, and the *policy* stays with the caller: this module never parses TOML, never
//! merges a patch, and never validates a schema. A bundle reads under the lock, transforms the text with its
//! own pure code, and commits — which keeps one implementation of the merge rules while the lock and the
//! rename have exactly one implementation each.
//!
//! ## Lock semantics, stated
//!
//! The lock is a sibling file, `{"<target>"}{DEFAULT_LOCK_SUFFIX}`, created with `O_EXCL`
//! (`create_new`). Creation is the acquisition; the file holds the holder's token, and every later use
//! re-reads it, so a lock taken away mid-transaction surfaces as [`ConfigError::Compromised`] instead of a
//! silent double-write. A lock older than [`LockPolicy::stale_ms`] is broken by the next caller: that is the
//! crash recovery, and it is why the token is written before the file is closed and synced.
//!
//! Waiting is a bounded backoff inside the host call — `retries` rounds of
//! [`LockPolicy::min_delay_ms`] growing by 1.2× up to [`LockPolicy::max_delay_ms`]. A realm call therefore
//! blocks the host thread while it waits, which is why the ceiling belongs to the policy and why a caller
//! that needs a shorter wait asks for fewer retries rather than getting an unbounded queue.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::filesystem::{FileCapability, FsCapabilityError, MAX_TEXT_BYTES};
use crate::support::{Clock, TimestampMs};

/// Suffix of the lock sibling, kept identical to `XIRANITE_CONFIG_LOCK_SUFFIX` in
/// `packages/config/src/node.ts` so a file locked by one side is visible to the other during the move.
pub const DEFAULT_LOCK_SUFFIX: &str = ".xr-write.lock";

/// How old a lock must be before a caller may break it. Matches the `stale: 30_000` the TypeScript passed.
pub const DEFAULT_STALE_MS: TimestampMs = 30_000;

/// Acquisition rounds. Matches the `retries: 50` default, and the ceiling the TypeScript validated.
pub const DEFAULT_RETRIES: u32 = 50;

/// The first backoff round, matching `minTimeout: 20` in `packages/config/src/node.ts:345`.
const DEFAULT_MIN_DELAY_MS: u64 = 20;

/// The longest one wait may be, matching `maxTimeout: 250`.
const DEFAULT_MAX_DELAY_MS: u64 = 250;

/// Growth factor of each backoff round, matching `factor: 1.2` in the TypeScript.
const BACKOFF_FACTOR: f64 = 1.2;

/// Prefix of the temp document an atomic replace writes before renaming it over the target.
const TEMP_PREFIX: &str = ".xiranite-tmp-";

/// How many times a temp name is redrawn before the write gives up.
const TEMP_ATTEMPTS: u32 = 32;

/// The waiting budget of one acquisition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LockPolicy {
    /// Age at which a lock is treated as a leftover from a dead holder.
    pub stale_ms: TimestampMs,
    /// Waits before giving up, so `0` means "try once, then refuse a *live* lock" — breaking a stale
    /// leftover does not spend this budget.
    pub retries: u32,
    /// First backoff round.
    pub min_delay_ms: u64,
    /// Ceiling for one backoff round.
    pub max_delay_ms: u64,
}

impl Default for LockPolicy {
    fn default() -> Self {
        Self {
            stale_ms: DEFAULT_STALE_MS,
            retries: DEFAULT_RETRIES,
            min_delay_ms: DEFAULT_MIN_DELAY_MS,
            max_delay_ms: DEFAULT_MAX_DELAY_MS,
        }
    }
}

impl LockPolicy {
    /// Rejects a policy that would wait unboundedly or never recover from a crash.
    ///
    /// The bounds are the ones `packages/config/src/node.ts:332` enforced (`0..=100`), kept because a
    /// caller that asked for `retries: 100_000` would park a host thread for hours on one config file.
    ///
    /// # Errors
    ///
    /// [`ConfigError::Refused`] with code `invalid_policy` when retries exceed 100 or the stale window is
    /// not positive.
    pub fn validate(self) -> Result<Self, ConfigError> {
        if self.retries > 100 {
            return Err(ConfigError::Refused {
                code: "invalid_policy",
                message: format!("lock retries must be an integer between 0 and 100, got {}", self.retries),
            });
        }
        if self.stale_ms == 0 {
            return Err(ConfigError::Refused {
                code: "invalid_policy",
                message: "a zero stale window would let any running holder be displaced".to_string(),
            });
        }
        if self.min_delay_ms > self.max_delay_ms {
            return Err(ConfigError::Refused {
                code: "invalid_policy",
                message: format!(
                    "min delay {} ms exceeds max delay {} ms",
                    self.min_delay_ms, self.max_delay_ms
                ),
            });
        }
        Ok(self)
    }

    /// The wait before round `attempt`, capped, so the growth cannot outrun the ceiling.
    fn delay_ms(&self, attempt: u32) -> u64 {
        let grown = (self.min_delay_ms as f64) * BACKOFF_FACTOR.powi(i32::try_from(attempt).unwrap_or(i32::MAX));
        (grown.round() as u64).clamp(self.min_delay_ms, self.max_delay_ms)
    }
}

/// Why a document could not be read or replaced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigError {
    /// Another holder owns the lock and it is not stale.
    Locked {
        /// The path that could not be locked.
        path: String,
    },
    /// The lock was taken from under this transaction, so its write was withheld.
    Compromised {
        /// The path whose lock is no longer ours.
        path: String,
    },
    /// No transaction holds that token — it was committed, aborted, or never issued.
    UnknownTransaction {
        /// The token the caller presented.
        token: String,
    },
    /// A host-side refusal that is not a capability decision (ceiling, policy, temp collision).
    Refused {
        /// The stable wire code.
        code: &'static str,
        /// The message half of the envelope.
        message: String,
    },
    /// The grant refused the path, or the OS failed. Authorization keeps one source: [`FileCapability`].
    Capability(FsCapabilityError),
}

impl ConfigError {
    /// The stable code a bundle's error envelope carries.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::Locked { .. } => "locked",
            Self::Compromised { .. } => "compromised",
            Self::UnknownTransaction { .. } => "unknown_transaction",
            Self::Refused { code, .. } => code,
            Self::Capability(error) => error.code(),
        }
    }

    /// The message half of the envelope.
    #[must_use]
    pub fn message(&self) -> String {
        match self {
            Self::Locked { path } => format!("timed out waiting for the Xiranite config writer: {path}"),
            Self::Compromised { path } => format!("the Xiranite config writer lock was compromised: {path}"),
            Self::UnknownTransaction { token } => {
                format!("no config transaction holds token {token:?}; it was finished or never began")
            }
            Self::Refused { message, .. } => message.clone(),
            Self::Capability(error) => error.message(),
        }
    }
}

impl From<FsCapabilityError> for ConfigError {
    fn from(error: FsCapabilityError) -> Self {
        Self::Capability(error)
    }
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code(), self.message())
    }
}

impl std::error::Error for ConfigError {}

/// One open read-modify-write: the document as it was, under a lock this store still holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transaction {
    /// Present it to [`ConfigStore::commit`] or [`ConfigStore::abort`].
    pub token: String,
    /// The canonical path the lock covers.
    pub path: String,
    /// The document as it read at acquisition, or `None` when the file did not exist yet.
    pub contents: Option<String>,
}

/// A locked, durable writer over one authorization grant.
#[derive(Debug)]
pub struct ConfigStore {
    files: FileCapability,
    clock: Arc<dyn Clock>,
    policy: LockPolicy,
    /// Every transaction this host has open, by token.
    sessions: std::sync::Mutex<HashMap<String, Session>>,
    sequence: AtomicU64,
}

/// What a token buys: the target, its lock sibling, and the string written into that lock.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Session {
    target: PathBuf,
    lock: PathBuf,
    token: String,
}

impl ConfigStore {
    /// Builds the service over an existing grant and clock, with the default waiting budget.
    #[must_use]
    pub fn new(files: FileCapability, clock: Arc<dyn Clock>) -> Self {
        Self::with_policy(files, clock, LockPolicy::default())
    }

    /// Same, with a caller-chosen waiting budget.
    #[must_use]
    pub fn with_policy(files: FileCapability, clock: Arc<dyn Clock>, policy: LockPolicy) -> Self {
        Self { files, clock, policy, sessions: std::sync::Mutex::new(HashMap::new()), sequence: AtomicU64::new(1) }
    }

    /// The policy in force, so a caller can report what a refusal waited for.
    #[must_use]
    pub const fn policy(&self) -> &LockPolicy {
        &self.policy
    }

    /// Reads one document without locking. A missing file is `Ok(None)`, never an error.
    ///
    /// Callers that intend to write back go through [`Self::begin`] instead: reading first and locking
    /// afterwards is the stale-snapshot bug `packages/config/src/node.ts:158` warned about.
    ///
    /// # Errors
    ///
    /// [`ConfigError::Capability`] when the grant refuses the path, the file is not UTF-8, or it is over
    /// [`MAX_TEXT_BYTES`].
    pub fn read(&self, path: &str) -> Result<Option<String>, ConfigError> {
        Ok(self.files.read_text(path)?)
    }

    /// Replaces one document atomically under a lock held only for this call.
    ///
    /// # Errors
    ///
    /// As [`Self::commit`]: [`ConfigError::Locked`] when the budget runs out, [`ConfigError::Capability`]
    /// for a refusal or an OS failure.
    pub fn write_atomic(&self, path: &str, contents: &str) -> Result<(), ConfigError> {
        let target = self.files.resolve(path)?;
        self.policy.validate()?;
        let token = self.next_token();
        self.acquire(&target, &token)?;
        let result = self.replace(&target, contents).and_then(|()| {
            // Re-check the lock the way the TypeScript did around every write
            // (`packages/config/src/index.ts:211-215`): a lock lost mid-write means somebody else may
            // have written the file, and the caller has to hear that before it believes its own write.
            self.ensure_held(&target, &token)
        });
        self.release(&target, &token);
        result
    }

    /// Takes the lock and reads the document, leaving the lock held for [`Self::commit`] or [`Self::abort`].
    ///
    /// # Errors
    ///
    /// [`ConfigError::Locked`] when the budget runs out, [`ConfigError::Capability`] for a refusal.
    pub fn begin(&self, path: &str) -> Result<Transaction, ConfigError> {
        let target = self.files.resolve(path)?;
        self.policy.validate()?;
        let token = self.next_token();
        self.acquire(&target, &token)?;
        let contents = self.files.read_text(&target.to_string_lossy())?;
        let lock = lock_path(&target);
        let canonical = target.to_string_lossy().into_owned();
        self.sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(token.clone(), Session { target, lock, token: token.clone() });
        Ok(Transaction { token, path: canonical, contents })
    }

    /// Writes the document and releases the lock taken by [`Self::begin`].
    ///
    /// # Errors
    ///
    /// [`ConfigError::UnknownTransaction`] for a token this store did not issue, [`ConfigError::Compromised`]
    /// when the lock is no longer ours (nothing is written in that case), [`ConfigError::Capability`] for a
    /// refusal or an OS failure.
    pub fn commit(&self, token: &str, contents: &str) -> Result<(), ConfigError> {
        let session = self.take_session(token)?;
        let result = self.ensure_held(&session.target, &session.token).and_then(|()| {
            self.replace(&session.target, contents)
        });
        self.drop_lock(&session.lock, &session.token);
        result
    }

    /// Releases the lock without writing.
    ///
    /// # Errors
    ///
    /// [`ConfigError::UnknownTransaction`] for a token this store did not issue.
    pub fn abort(&self, token: &str) -> Result<(), ConfigError> {
        let session = self.take_session(token)?;
        self.drop_lock(&session.lock, &session.token);
        Ok(())
    }

    /// The token this host writes into a lock file: pid plus a per-store counter. The pid is what makes it
    /// unique across the processes this lock is meant to arbitrate between.
    fn next_token(&self) -> String {
        format!("{}-{}", std::process::id(), self.sequence.fetch_add(1, Ordering::Relaxed))
    }

    /// Creates the lock sibling, waiting up to the policy's budget, breaking a lock older than stale.
    ///
    /// `retries` counts **waits**, not attempts: breaking a stale lock is progress, not a failed round, so
    /// it must not spend the budget. `retries: 0` therefore still recovers from a crashed holder on the
    /// first sight of its leftover lock, and only a *live* lock produces [`ConfigError::Locked`] immediately.
    fn acquire(&self, target: &Path, token: &str) -> Result<(), ConfigError> {
        let lock = lock_path(target);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| ConfigError::Capability(FsCapabilityError::host("ensure_dir_failed", error)))?;
        }
        let mut waits = 0_u32;
        loop {
            match Self::try_create_lock(&lock, token) {
                Ok(()) => return Ok(()),
                Err(LockAttempt::Busy) => {
                    if self.is_stale(&lock) {
                        // The crash-recovery arm: the holder is gone and only its lockfile is left behind.
                        let _ = std::fs::remove_file(&lock);
                        continue;
                    }
                    if waits >= self.policy.retries {
                        return Err(ConfigError::Locked { path: target.to_string_lossy().into_owned() });
                    }
                    std::thread::sleep(std::time::Duration::from_millis(self.policy.delay_ms(waits)));
                    waits += 1;
                }
                Err(LockAttempt::Failed(error)) => {
                    return Err(ConfigError::Capability(FsCapabilityError::host("lock_failed", error)));
                }
            }
        }
    }

    /// One `O_EXCL` creation attempt, told apart by *why* it failed rather than by the message text.
    fn try_create_lock(lock: &Path, token: &str) -> Result<(), LockAttempt> {
        let mut file = match std::fs::OpenOptions::new().write(true).create_new(true).open(lock) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => return Err(LockAttempt::Busy),
            Err(error) => return Err(LockAttempt::Failed(error)),
        };
        if let Err(error) = file.write_all(token.as_bytes()).and_then(|()| file.sync_all()) {
            // A lock whose contents did not land is not a lock: leave nothing behind for the next caller to
            // mistake for a holder.
            let _ = std::fs::remove_file(lock);
            return Err(LockAttempt::Failed(error));
        }
        Ok(())
    }

    /// Whether a lock file is old enough to belong to a process that is gone.
    ///
    /// A lock whose time cannot be read is treated as *live*, not stale: the alternative is to delete a
    /// holder's lock on the strength of a failed metadata call, and the cost of being wrong that way is a
    /// double write. Waiting it out costs one budget and ends in [`ConfigError::Locked`], which is the
    /// conservative answer.
    fn is_stale(&self, lock: &Path) -> bool {
        let Ok(metadata) = lock.metadata() else {
            return false;
        };
        let Ok(created) = metadata.modified() else {
            return false;
        };
        let Ok(since_epoch) = created.duration_since(std::time::UNIX_EPOCH) else {
            return false;
        };
        let created_ms = since_epoch.as_millis().min(u128::from(u64::MAX)) as u64;
        self.clock.now_ms().saturating_sub(created_ms) >= self.policy.stale_ms
    }

    /// Refuses when the lock file no longer carries our token.
    fn ensure_held(&self, target: &Path, token: &str) -> Result<(), ConfigError> {
        let lock = lock_path(target);
        let holder = std::fs::read_to_string(&lock).unwrap_or_default();
        if holder == token {
            Ok(())
        } else {
            Err(ConfigError::Compromised { path: target.to_string_lossy().into_owned() })
        }
    }

    fn release(&self, target: &Path, token: &str) {
        self.drop_lock(&lock_path(target), token);
    }

    /// Removes a lock we still own. Someone else's lock is left alone, and a lock that is already gone is
    /// not an error: the transaction's answer is already decided by then.
    fn drop_lock(&self, lock: &Path, token: &str) {
        if std::fs::read_to_string(lock).ok().as_deref() == Some(token) {
            let _ = std::fs::remove_file(lock);
        }
    }

    fn take_session(&self, token: &str) -> Result<Session, ConfigError> {
        self.sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(token)
            .ok_or_else(|| ConfigError::UnknownTransaction { token: token.to_string() })
    }

    /// Writes a temp document in the target's own directory, syncs it, then renames it over the target.
    ///
    /// Same-directory is the point: a rename across volumes is not atomic, and `packages/file-operations`
    /// keeps data on a different drive than the config root.
    fn replace(&self, target: &Path, contents: &str) -> Result<(), ConfigError> {
        if contents.len() as u64 > MAX_TEXT_BYTES {
            return Err(ConfigError::Refused {
                code: "text_too_large",
                message: format!(
                    "{} bytes exceeds the {MAX_TEXT_BYTES} byte document ceiling",
                    contents.len()
                ),
            });
        }
        let directory = target.parent().ok_or_else(|| ConfigError::Refused {
            code: "no_directory",
            message: format!("{} has no directory to write a temp document into", target.display()),
        })?;
        let (mut file, temp) = self.create_temp(directory)?;
        let mut outcome = file.write_all(contents.as_bytes()).and_then(|()| file.sync_all());
        drop(file);
        if outcome.is_ok() {
            outcome = std::fs::rename(&temp, target);
        }
        if let Err(error) = outcome {
            // The temp is this write's own file, so removing it on failure cannot touch a sibling's work.
            let _ = std::fs::remove_file(&temp);
            return Err(ConfigError::Capability(FsCapabilityError::host("write_failed", error)));
        }
        Ok(())
    }

    /// Reserves a temp document by *creating* it exclusively. The name is never claimed and then reopened —
    /// `create_new` twice on one path is a guaranteed collision with oneself.
    fn create_temp(&self, directory: &Path) -> Result<(std::fs::File, PathBuf), ConfigError> {
        for _ in 0..TEMP_ATTEMPTS {
            let name =
                format!("{TEMP_PREFIX}{}-{}", std::process::id(), self.sequence.fetch_add(1, Ordering::Relaxed));
            let candidate = directory.join(name);
            match std::fs::OpenOptions::new().write(true).create_new(true).open(&candidate) {
                Ok(file) => return Ok((file, candidate)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(ConfigError::Capability(FsCapabilityError::host("write_failed", error)));
                }
            }
        }
        Err(ConfigError::Refused {
            code: "temp_collision",
            message: format!("could not reserve a temp document in {}", directory.display()),
        })
    }
}

/// Why one lock creation failed, told by `ErrorKind` rather than by message text.
enum LockAttempt {
    /// The sibling already exists: somebody holds the lock, or a dead holder left it.
    Busy,
    /// Anything else — a real I/O or permission failure, which is not a wait.
    Failed(std::io::Error),
}

/// The lock sibling of one target: `<target>.xr-write.lock`, the same name the TypeScript used.
#[must_use]
pub fn lock_path(target: &Path) -> PathBuf {
    let mut name = target.as_os_str().to_os_string();
    name.push(DEFAULT_LOCK_SUFFIX);
    PathBuf::from(name)
}
