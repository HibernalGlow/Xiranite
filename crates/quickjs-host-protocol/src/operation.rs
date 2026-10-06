//! The closed list of operations a realm may ask for.
//!
//! This is the boundary the shim layer codes against and the host answers; a name outside it is a call
//! failure that carries the answered list, never a trap. `packages/quickjs-shims/src/host.ts`
//! (`OPERATIONS_V1`) is the JavaScript half, and `bun run audit:quickjs-host-ops` fails if the two drift.

/// One host operation, named exactly as the shim layer names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostOperation {
    /// `fs.stat` — kind, and with a grant also size and times.
    Stat,
    /// `fs.list` — one directory level.
    List,
    /// `fs.readText` — one bounded text document.
    ReadText,
    /// `fs.writeText` — one bounded text document, creating the parent.
    WriteText,
    /// `fs.ensureDir` — directory and its parents.
    EnsureDir,
    /// `fs.move` — rename with the host's cross-volume fallback.
    Move,
    /// `fs.delete` — delete, refusing a non-empty directory unless `recursive`.
    Delete,
    /// `fs.mkdtemp` — a unique directory inside the grant.
    Mkdtemp,
    /// `fs.copy` — one file, or a tree.
    Copy,
    /// `fs.appendText` — append without reading the document back.
    AppendText,
    /// `fs.utimes` — restore access and modification times.
    Utimes,
    /// `fs.readBytes` — a bounded buffer, optionally a range. The only arm that answers bytes.
    ReadBytes,
    /// `fs.writeBytes` — a bounded buffer, taking its payload out of band.
    WriteBytes,
    /// `fs.link` — hard link.
    Link,
    /// `fs.symlink` — symbolic link.
    Symlink,
    /// `fs.readlink` — the stored target text.
    Readlink,
    /// `fs.realpath` — the canonical path, still inside the grant.
    Realpath,
    /// `proc.exec` — one external program from the caller's registration, waited on.
    ProcExec,
    /// `proc.spawn` — one external program from the registration, left running.
    ProcSpawn,
    /// `proc.poll` — a live child's state plus the transcript text since an offset.
    ProcPoll,
    /// `proc.wait` — reap a live child and answer its transcript.
    ProcWait,
    /// `proc.kill` — stop a child this run started.
    ProcKill,
    /// `clock.now` — the host clock in the journals' spelling.
    ClockNow,
    /// `clock.sleep` — wait on the host's clock. The realm has no timers of its own, so a node that
    /// waits at all (a countdown, a sampling loop) asks the host to wait for it.
    ClockSleep,
    /// `crypto.randomUUID` — one id, host-supplied so a script never reads `Math.random()`.
    RandomUuid,
    /// `crypto.randomBytes` — up to [`crate::MAX_RANDOM_BYTES`] bytes, hex-encoded.
    RandomBytes,
    /// `crypto.digest` — a host SHA-1/SHA-256 over a payload that crossed out of band.
    Digest,
    /// `os.tmpdir` — the host's temporary directory.
    OsTmpdir,
    /// `os.homedir` — the host's home directory, from its own environment.
    OsHomedir,
    /// `os.cpus` — how many workers the host may ask for.
    OsCpus,
    /// `service.invoke` — one call against a host service this node declared it needs.
    ///
    /// The only arm that carries a node's domain vocabulary, and it carries none of its own: the service
    /// and method names are arguments, resolved against a table that says which engine answers which
    /// name. A node-specific engine gets a *service*, not four new operations on the machine surface.
    ServiceInvoke,
}

impl HostOperation {
    /// Every operation, in the order the protocol lists them.
    pub const ALL: &'static [Self] = &[
        Self::Stat,
        Self::List,
        Self::ReadText,
        Self::WriteText,
        Self::EnsureDir,
        Self::Move,
        Self::Delete,
        Self::Mkdtemp,
        Self::Copy,
        Self::AppendText,
        Self::Utimes,
        Self::ReadBytes,
        Self::WriteBytes,
        Self::Link,
        Self::Symlink,
        Self::Readlink,
        Self::Realpath,
        Self::ProcExec,
        Self::ProcSpawn,
        Self::ProcPoll,
        Self::ProcWait,
        Self::ProcKill,
        Self::ClockNow,
        Self::ClockSleep,
        Self::RandomUuid,
        Self::RandomBytes,
        Self::Digest,
        Self::OsTmpdir,
        Self::OsHomedir,
        Self::OsCpus,
        Self::ServiceInvoke,
    ];

    /// The wire name a bundle calls.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Stat => "fs.stat",
            Self::List => "fs.list",
            Self::ReadText => "fs.readText",
            Self::WriteText => "fs.writeText",
            Self::EnsureDir => "fs.ensureDir",
            Self::Move => "fs.move",
            Self::Delete => "fs.delete",
            Self::Mkdtemp => "fs.mkdtemp",
            Self::Copy => "fs.copy",
            Self::AppendText => "fs.appendText",
            Self::Utimes => "fs.utimes",
            Self::ReadBytes => "fs.readBytes",
            Self::WriteBytes => "fs.writeBytes",
            Self::Link => "fs.link",
            Self::Symlink => "fs.symlink",
            Self::Readlink => "fs.readlink",
            Self::Realpath => "fs.realpath",
            Self::ProcExec => "proc.exec",
            Self::ProcSpawn => "proc.spawn",
            Self::ProcPoll => "proc.poll",
            Self::ProcWait => "proc.wait",
            Self::ProcKill => "proc.kill",
            Self::ClockNow => "clock.now",
            Self::ClockSleep => "clock.sleep",
            Self::RandomUuid => "crypto.randomUUID",
            Self::RandomBytes => "crypto.randomBytes",
            Self::Digest => "crypto.digest",
            Self::OsTmpdir => "os.tmpdir",
            Self::OsHomedir => "os.homedir",
            Self::OsCpus => "os.cpus",
            Self::ServiceInvoke => "service.invoke",
        }
    }

    /// Resolves a wire name. An unknown name is a *call* failure carrying the answered list, not a
    /// protocol failure: the bundle asked for something this host does not answer.
    #[must_use]
    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|operation| operation.as_str() == name)
    }

    /// The names, for error text and for the audit that keeps the shim and the host in step.
    #[must_use]
    pub fn names() -> Vec<&'static str> {
        Self::ALL.iter().copied().map(Self::as_str).collect()
    }

    /// Whether this operation takes a byte payload from the realm.
    ///
    /// Part of the protocol's shape, not a detail of one arm: the realm bridge refuses `__xrh.call` for
    /// these and the pump refuses an inline buffer for them, so a byte can only ever arrive out of band.
    #[must_use]
    pub const fn takes_payload(self) -> bool {
        matches!(self, Self::WriteBytes | Self::Digest)
    }

    /// Whether this operation's answer is a buffer rather than a document.
    #[must_use]
    pub const fn answers_bytes(self) -> bool {
        matches!(self, Self::ReadBytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_vocabulary_is_the_agreed_list_and_every_name_parses() {
        // The literal list is the contract with `packages/quickjs-shims/src/host.ts`: rebuilding `names()`
        // from `ALL` here would let a rename pass this test and fail the audit for whoever is downstream.
        assert_eq!(
            HostOperation::names(),
            vec![
                "fs.stat",
                "fs.list",
                "fs.readText",
                "fs.writeText",
                "fs.ensureDir",
                "fs.move",
                "fs.delete",
                "fs.mkdtemp",
                "fs.copy",
                "fs.appendText",
                "fs.utimes",
                "fs.readBytes",
                "fs.writeBytes",
                "fs.link",
                "fs.symlink",
                "fs.readlink",
                "fs.realpath",
                "proc.exec",
                "proc.spawn",
                "proc.poll",
                "proc.wait",
                "proc.kill",
                "clock.now",
                "clock.sleep",
                "crypto.randomUUID",
                "crypto.randomBytes",
                "crypto.digest",
                "os.tmpdir",
                "os.homedir",
                "os.cpus",
                "service.invoke",
            ]
        );
        for name in HostOperation::names() {
            assert_eq!(HostOperation::parse(name).map(HostOperation::as_str), Some(name));
        }
        assert_eq!(HostOperation::parse("fs.readRange"), None, "an invented name must not parse");
        assert_eq!(HostOperation::parse("fs.read_bytes"), None, "the Rust spelling is not the wire spelling");
    }

    #[test]
    fn the_list_has_no_duplicate_wire_names() {
        // The audit diffs this list against the shim's. A name two arms answer would still read clean in
        // that difference set while `parse` silently resolved to whichever arm came first.
        let names = HostOperation::names();
        let unique: std::collections::HashSet<&str> = names.iter().copied().collect();
        assert_eq!(unique.len(), names.len(), "{names:?}");
        assert!(names.iter().all(|name| name.contains('.')), "{names:?}");
    }

    #[test]
    fn exactly_the_byte_operations_take_or_answer_a_buffer() {
        // The shim and the engine both branch on these two, so the sets are asserted rather than implied by
        // which arm happens to read `payload`.
        for operation in [HostOperation::WriteBytes, HostOperation::Digest] {
            assert!(operation.takes_payload(), "{} must take bytes", operation.as_str());
        }
        assert!(
            HostOperation::ReadBytes.answers_bytes(),
            "fs.readBytes must answer bytes, got {}",
            HostOperation::ReadBytes.as_str()
        );
        for operation in [
            HostOperation::Stat,
            HostOperation::ReadText,
            HostOperation::ProcExec,
            HostOperation::OsCpus,
        ] {
            assert!(!operation.takes_payload() && !operation.answers_bytes(), "{operation:?} is text both ways");
        }
    }
}
