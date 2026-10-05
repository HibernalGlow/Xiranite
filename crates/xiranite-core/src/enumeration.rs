//! The host-side recursive directory walk ADR-0072 Decision 1 and 4 ask for.
//!
//! ADR-0071 handed plugins `std::fs` through WASI preopens, and for *content* that is the right call.
//! For a **tree** it is not: measured on this machine, a guest `read_dir` walk costs 3.6×–35× what the
//! same walk costs the host, and it grows superlinearly with directory size, because the preview1 shim
//! (`wasi-common-43.0.2/src/sync/dir.rs:168-225`) reopens the directory and re-stats every entry on
//! each `fd_readdir(cookie)` resume. So the walk happens here, in the host process, and the guest gets a
//! [`LISTING_PROTOCOL`] document it reads with the cheap path.
//!
//! ## Why this lives in `xiranite-core` for now
//!
//! ADR-0072 Decision 1 names `xiranite-node-runtime`, because the point is that the walk is
//! *in-process*: every face links it, and a per-node bundle ships its own host. The three things a walk
//! needs — `FileCapability`, `OperationControl`, `OperationManager` — all live here already, and
//! `xiranite-node-runtime` does not compile while its `SERVED_CAPABILITIES` still lists the
//! `xiranite.fs.*` names ADR-0071 retired. Moving this module one crate up is a `pub mod` line once
//! that retirement lands; the layering Decision 1 actually cares about (in-process, never an HTTP route)
//! holds either way.
//!
//! ## The two reads the walk makes
//!
//! The walk performs exactly two filesystem operations — list one directory, size one path — and
//! [`WalkSource`] names them. That is not ceremony for a future second filesystem: the listing order,
//! the ceilings, the per-directory boundary and the "refuse rather than truncate a subtree" rule are all
//! properties of *this* seam, so one set of assertions (`tests/walk_contract.rs`) runs against
//! [`FileCapability`] and against [`MemoryWalkSource`] instead of only against a disk. The memory source
//! also covers the two cases a disk cannot cover on every host the same way: a symlink row (creating one
//! needs a privilege Windows does not grant by default) and a directory that becomes unlistable mid-walk.
//!
//! ## The boundary the walk owes the operation
//!
//! ADR-0066's pause waits *inside a host call*, and during a pre-walk the guest is not running yet, so
//! `POST /operations/:id/pause|cancel` would have nothing to act on (ADR-0072 Decision 4). [`WalkGate`]
//! is that seam: the walk asks it before entering **each directory**, and the gate reads the same phase
//! the `xiranite.operation.checkpoint` host call reads. Per directory, not per entry — a flat 16,000
//! entry directory would otherwise cost 16,000 phase reads to buy one pause.

use std::time::Duration;

use xiranite_plugin_api::{OpaquePayload, PluginRunEventKind};

use crate::filesystem::{
    DirEntryInfo, FileCapability, FsCapabilityError, join_paths, normalize_separators,
};
use crate::operation::{NodeRunEventRecord, OperationControl, OperationManager, OperationPhase};

/// The listing document's version tag. The leading `#` is what keeps it from colliding with a path.
pub const LISTING_PROTOCOL: &str = "#xiranite-listing/1";
/// The field separator ADR-0072 settled on: `name<TAB>type<TAB>size?`.
pub const LISTING_SEPARATOR: char = '\t';
/// How many entries one walk may emit before refusing. A listing is an input document, so its size is
/// bounded by whatever ceiling the input carries — stating that ceiling here is the ADR's own "say it in
/// the same change that lands this" requirement (Consequences).
pub const DEFAULT_MAX_ENTRIES: usize = 200_000;
/// The same ceiling in bytes: the measured 22,000-entry tree encoded to 242 KB, so this is ~80× that.
pub const DEFAULT_MAX_LISTING_BYTES: usize = 32 * 1024 * 1024;
/// ADR-0066's park cadence, the same bounded sleep loop `xiranite.operation.checkpoint` uses: far under
/// what a human perceives, and not so tight that a paused walk spins on the operation mutex.
pub const PARK_POLL_INTERVAL: Duration = Duration::from_millis(50);

/// What a walk needs from the filesystem, and nothing else.
pub trait WalkSource {
    /// One directory level, sorted by name, with the entry kinds taken off the directory read itself.
    ///
    /// Implementations must spell each entry `parent/name` using **the caller's own spelling** of
    /// `parent`, the way [`FileCapability::list`] does (`filesystem.rs:312-314`): publishing a
    /// canonicalized path instead would show `/private/var/…` on macOS and hand the guest a prefix it was
    /// never granted, changing every plan row. Kinds come from the dirent because `list()` never stats —
    /// that is ADR-0072 Decision 5's 62 ms → 17 ms on a flat 16,000-entry directory.
    fn list(&self, path: &str) -> Result<Vec<DirEntryInfo>, FsCapabilityError>;

    /// The byte size of one path, asked only when [`WalkRequest::want_sizes`] is set.
    ///
    /// `0` for a directory and for a path that disappeared since [`Self::list`], because that is what
    /// [`FileCapability::stat`] already reports: `size_bytes` is `0` for a directory, and a failed read
    /// answers the `exists: false` shape rather than an error (`filesystem.rs:276-283`). A file removed
    /// mid-walk therefore still gets a row with size `0` instead of failing the whole operation.
    fn size(&self, path: &str) -> Result<u64, FsCapabilityError>;
}

impl WalkSource for FileCapability {
    fn list(&self, path: &str) -> Result<Vec<DirEntryInfo>, FsCapabilityError> {
        FileCapability::list(self, path)
    }

    fn size(&self, path: &str) -> Result<u64, FsCapabilityError> {
        FileCapability::stat(self, path).map(|info| info.size_bytes)
    }
}

/// Where the walk stands at one boundary, in the units an operation reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WalkState {
    /// Directories listed so far, counting each root.
    pub directories: usize,
    /// Entries emitted so far.
    pub entries: usize,
    /// Listing bytes written so far.
    pub bytes: usize,
}

/// What a gate answers at a directory boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Boundary {
    /// Enter the directory.
    Enter,
    /// Cancelled or terminal: stop, and hand the guest nothing.
    Cancelled,
}

/// The pause/cancel seam between one walk and one operation.
pub trait WalkGate {
    /// Called before the walk lists each directory.
    fn at_directory(&mut self, state: &WalkState) -> Boundary;
}

/// The gate that reads the operation's phase, which is what makes a pre-walk pausable at all.
///
/// `wait` runs once per waiting round. Production sleeps [`PARK_POLL_INTERVAL`]; a test drives the
/// operation's phase from it, so "parks between directories" is asserted structurally instead of by
/// timing. It is a field rather than another trait because the *decision* — park versus stop — must
/// live in exactly one place: that decision is what ADR-0066 pins, and a second copy in a test would
/// only be testing the test.
pub struct PhaseGate<'a> {
    /// The operation being served.
    pub control: &'a OperationControl,
    /// One waiting round.
    pub wait: Box<dyn FnMut() + 'a>,
}

impl<'a> PhaseGate<'a> {
    /// A gate that sleeps between phase reads.
    #[must_use]
    pub fn sleeping(control: &'a OperationControl) -> Self {
        Self { control, wait: Box::new(|| std::thread::sleep(PARK_POLL_INTERVAL)) }
    }
}

impl WalkGate for PhaseGate<'_> {
    fn at_directory(&mut self, _state: &WalkState) -> Boundary {
        loop {
            if self.control.cancel_requested() || self.control.phase().is_terminal() {
                return Boundary::Cancelled;
            }
            if self.control.phase() != OperationPhase::Paused {
                return Boundary::Enter;
            }
            (self.wait)();
        }
    }
}

/// The gate a face uses when a paused walk must also be *visible*: one progress event, then the same
/// phase boundary.
///
/// The event fires once, at the first directory, because that is what the guest did — `samea` emits its
/// `scanning` progress before the plan call (`plugins/samea/src/run.rs:71`), while its per-directory
/// checkpoint emits nothing: the host ignores the counts a checkpoint carries
/// (`crates/xiranite-node-runtime/src/capabilities.rs:222-237`). A per-directory event would be a new
/// observable, not a replacement for one.
pub struct ReportingGate<'a> {
    /// The phase boundary this gate adds reporting to.
    pub gate: PhaseGate<'a>,
    /// The operation's event sink.
    pub manager: &'a OperationManager,
    /// The operation the event belongs to.
    pub operation_id: &'a str,
    /// The message the monitor shows, spelled by the caller so each node keeps its own wording.
    pub message: &'a str,
    reported: bool,
}

impl<'a> ReportingGate<'a> {
    /// Wraps a sleeping phase gate with one progress event.
    #[must_use]
    pub fn new(
        control: &'a OperationControl,
        manager: &'a OperationManager,
        operation_id: &'a str,
        message: &'a str,
    ) -> Self {
        Self {
            gate: PhaseGate::sleeping(control),
            manager,
            operation_id,
            message,
            reported: false,
        }
    }
}

impl WalkGate for ReportingGate<'_> {
    fn at_directory(&mut self, state: &WalkState) -> Boundary {
        if !self.reported {
            self.reported = true;
            // `progress: None` is honest: a walk cannot know its total before it finishes, and the
            // schema says the field is absent when the run cannot estimate.
            let counts =
                format!("{{\"directories\":{},\"entries\":{}}}", state.directories, state.entries);
            self.manager.push_event(
                self.operation_id,
                NodeRunEventRecord {
                    kind: PluginRunEventKind::Progress,
                    progress: None,
                    message: self.message.to_string(),
                    data: Some(OpaquePayload::from_text(&counts)),
                },
            );
        }
        self.gate.at_directory(state)
    }
}

/// What one walk should produce.
#[derive(Debug, Clone)]
pub struct WalkRequest {
    /// The roots to walk, spelled as the guest spells them; each must sit inside the grant.
    pub roots: Vec<String>,
    /// Emit a size per entry. Off by default because the cheap shape is the whole point: `list()` reads
    /// `file_type()` and never stats, worth 62 ms → 17 ms on the measured flat 16,000-entry directory
    /// (ADR-0072 Decision 5). A node that needs sizes says so in its definition.
    pub want_sizes: bool,
    /// Refuse past this many entries.
    pub max_entries: usize,
    /// Refuse past this many listing bytes.
    pub max_listing_bytes: usize,
}

impl WalkRequest {
    /// A request over `roots` with the settled ceilings and no sizes.
    #[must_use]
    pub fn new(roots: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            roots: roots.into_iter().map(Into::into).collect(),
            want_sizes: false,
            max_entries: DEFAULT_MAX_ENTRIES,
            max_listing_bytes: DEFAULT_MAX_LISTING_BYTES,
        }
    }
}

/// What a walk produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Walked {
    /// The encoded [`LISTING_PROTOCOL`] document.
    pub listing: String,
    /// Entries emitted, excluding the header.
    pub entry_count: usize,
    /// Directories listed, including each root.
    pub directory_count: usize,
}

/// Which ceiling stopped a walk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ceiling {
    /// The ceiling's name, for the operation's error text.
    pub which: &'static str,
    /// The configured limit.
    pub limit: usize,
    /// What the walk had already reached when it tripped.
    pub seen: usize,
}

/// The outcome of one walk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WalkOutcome {
    /// A listing the guest can read.
    Listing(Walked),
    /// Cancelled at a directory boundary, so the guest never started.
    Cancelled,
    /// A ceiling stopped the walk. The caller must fail the operation: a silently truncated tree reads
    /// exactly like a complete plan.
    Refused(Ceiling),
    /// The grant refused a path, or a directory could not be listed mid-walk.
    Failed(FsCapabilityError),
}

/// One directory's pending entries — the frame the guest walk kept, kept here instead.
struct Frame {
    entries: Vec<DirEntryInfo>,
    index: usize,
}

/// Walks every root depth-first and encodes one [`LISTING_PROTOCOL`] document.
///
/// Order and shape come from the [`WalkSource`], which is [`FileCapability`] in production: it sorts by
/// name and reads `file_type()` without stat. `samea`'s and `classq`'s guest walks did the same, and
/// neither descended into a symlink (`DirEntry::file_type` does not follow links), so moving the walk
/// moves no plan row and cannot loop on a link cycle. The ceilings bound depth.
pub fn walk(
    source: &dyn WalkSource,
    gate: &mut dyn WalkGate,
    request: &WalkRequest,
) -> WalkOutcome {
    let mut body = String::new();
    let mut state = WalkState { directories: 0, entries: 0, bytes: 0 };
    for root in &request.roots {
        match walk_one_root(source, gate, request, root, &mut body, &mut state) {
            RootWalk::Done => {}
            RootWalk::Stop(outcome) => return outcome,
        }
    }
    let header = format!(
        "{LISTING_PROTOCOL}{LISTING_SEPARATOR}roots={}{}sizes={}",
        request.roots.len(),
        LISTING_SEPARATOR,
        usize::from(request.want_sizes),
    );
    WalkOutcome::Listing(Walked {
        listing: format!("{header}\n{body}"),
        entry_count: state.entries,
        directory_count: state.directories,
    })
}

/// Why one root's walk ended.
enum RootWalk {
    /// The root is fully walked.
    Done,
    /// The whole walk must end with this outcome.
    Stop(WalkOutcome),
}

fn walk_one_root(
    source: &dyn WalkSource,
    gate: &mut dyn WalkGate,
    request: &WalkRequest,
    root: &str,
    body: &mut String,
    state: &mut WalkState,
) -> RootWalk {
    // A root is not itself an entry line — the guest knows the path it asked to walk, and `samea` and
    // `classq` emitted only what `readdir` returned.
    if gate.at_directory(state) == Boundary::Cancelled {
        return RootWalk::Stop(WalkOutcome::Cancelled);
    }
    let listing = match source.list(root) {
        Ok(listing) => listing,
        Err(error) => return RootWalk::Stop(WalkOutcome::Failed(error)),
    };
    state.directories += 1;
    let mut stack = vec![Frame { entries: listing, index: 0 }];

    while !stack.is_empty() {
        // Take one entry, then release the borrow: descending pushes a frame the borrow would refuse.
        let next = {
            let frame = stack.last_mut().expect("the loop keeps the stack non-empty");
            if frame.index >= frame.entries.len() {
                None
            } else {
                let entry = frame.entries[frame.index].clone();
                frame.index += 1;
                Some(entry)
            }
        };
        let Some(entry) = next else {
            stack.pop();
            continue;
        };

        let size = if request.want_sizes {
            match source.size(&entry.path) {
                Ok(bytes) => Some(bytes),
                Err(error) => return RootWalk::Stop(WalkOutcome::Failed(error)),
            }
        } else {
            None
        };
        let line = encode_entry(&entry, size);
        if state.entries + 1 > request.max_entries {
            return RootWalk::Stop(WalkOutcome::Refused(Ceiling {
                which: "entries",
                limit: request.max_entries,
                seen: state.entries,
            }));
        }
        if state.bytes + line.len() + 1 > request.max_listing_bytes {
            return RootWalk::Stop(WalkOutcome::Refused(Ceiling {
                which: "listing_bytes",
                limit: request.max_listing_bytes,
                seen: state.bytes,
            }));
        }
        body.push_str(&line);
        body.push('\n');
        state.entries += 1;
        state.bytes += line.len() + 1;

        if !entry.is_directory {
            continue;
        }
        if gate.at_directory(state) == Boundary::Cancelled {
            return RootWalk::Stop(WalkOutcome::Cancelled);
        }
        match source.list(&entry.path) {
            Ok(children) => {
                state.directories += 1;
                stack.push(Frame { entries: children, index: 0 });
            }
            // An unlistable directory fails the walk rather than skipping a subtree: a plan that
            // quietly lost a branch is indistinguishable from a complete one.
            Err(error) => return RootWalk::Stop(WalkOutcome::Failed(error)),
        }
    }
    RootWalk::Done
}

/// One `name<TAB>type<TAB>size?` line. Field 1 is the path as [`WalkSource::list`] spells it
/// (`parent/name` in the caller's own spelling), because a bare name is not addressable in a tree.
#[must_use]
pub fn encode_entry(entry: &DirEntryInfo, size: Option<u64>) -> String {
    let kind = if entry.is_directory { 'd' } else { 'f' };
    match size {
        Some(bytes) => format!("{}{LISTING_SEPARATOR}{kind}{LISTING_SEPARATOR}{bytes}", entry.path),
        None => format!("{}{LISTING_SEPARATOR}{kind}", entry.path),
    }
}

/// One decoded entry line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedEntry {
    /// The path as the host spelled it, separators normalized.
    pub path: String,
    /// Whether the entry is a directory.
    pub is_directory: bool,
    /// The size, present only when the walk was asked for sizes.
    pub size: Option<u64>,
}

/// The header of a listing document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListingHeader {
    /// How many roots the walk covered.
    pub roots: usize,
    /// Whether entries carry a size.
    pub sizes: bool,
}

/// Decodes one entry line, or `None` for a header or a malformed line — a reader must be able to
/// refuse a document it cannot trust rather than plan on half a tree.
#[must_use]
pub fn decode_entry(line: &str) -> Option<DecodedEntry> {
    let mut fields = line.split(LISTING_SEPARATOR);
    let path = fields.next().filter(|path| !path.is_empty())?;
    let is_directory = match fields.next()? {
        "d" => true,
        "f" => false,
        _ => return None,
    };
    let size = match fields.next() {
        Some(text) => Some(text.parse::<u64>().ok()?),
        None => None,
    };
    if fields.next().is_some() {
        return None;
    }
    Some(DecodedEntry { path: normalize_separators(path), is_directory, size })
}

/// Reads a whole document into header plus entries.
#[must_use]
pub fn parse_listing(document: &str) -> Option<(ListingHeader, Vec<DecodedEntry>)> {
    let mut lines = document.lines();
    let header = lines.next()?.strip_prefix(&format!("{LISTING_PROTOCOL}{LISTING_SEPARATOR}"))?;
    let mut roots = None;
    let mut sizes = false;
    for field in header.split(LISTING_SEPARATOR) {
        if let Some(text) = field.strip_prefix("roots=") {
            roots = Some(text.parse::<usize>().ok()?);
        } else {
            match field.strip_prefix("sizes=") {
                Some("1") => sizes = true,
                Some("0") => {}
                _ => return None,
            }
        }
    }
    let mut decoded = Vec::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        decoded.push(decode_entry(line)?);
    }
    Some((ListingHeader { roots: roots?, sizes }, decoded))
}

/// Which kind a [`MemoryWalkSource`] row holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoryKind {
    /// A regular file, carrying the size a sized listing must report.
    File,
    /// A directory the walk descends into. Its spec size is ignored; `0` is what a listing carries.
    Directory,
    /// A symbolic link: emitted as a leaf and never entered, which is what `DirEntry::file_type()`
    /// reports and the property ADR-0072 keeps from the guest walks. Two hosts differ on the rest of it
    /// — creating one needs a privilege Windows does not grant by default, and [`FileCapability::stat`]
    /// sizes a link by its target string via `lstat` where this source reports `0` — so a sized listing
    /// of a `Symlink` row is this source's shape, not something the contract compares across hosts.
    Symlink,
}

/// One row of a [`MemoryWalkSource`] tree, with its absolute spelling resolved at construction.
#[derive(Debug, Clone)]
struct MemoryRow {
    path: String,
    name: String,
    kind: MemoryKind,
    size: u64,
}

/// Splits an absolute `/`-separated path into its parent and last component.
///
/// The same rule as [`join_paths`] reversed, so a row's parent and the path its listing hands out cannot
/// drift apart; `/link` sits directly under the filesystem root, which is the `Some(0)` arm.
fn split_path(path: &str) -> (&str, &str) {
    match path.rfind('/') {
        Some(0) => ("/", &path[1..]),
        Some(index) => (&path[..index], &path[index + 1..]),
        None => ("", path),
    }
}

/// A tree that answers [`WalkSource`] from memory.
///
/// This exists so [`walk`]'s contract is checkable on any host: the order, the ceilings, the
/// per-directory boundary and the symlink leaf all get asserted against a shape a disk cannot guarantee
/// (a link needs a Windows privilege, and an unlistable directory needs `chmod`). It is a second
/// implementation of the *port*, not a second walk — it spells entry paths with the shared
/// [`join_paths`] and sorts with the same comparator, so it cannot invent a rule the real source lacks.
///
/// Two things are deliberately absent because they are not the walk's business: the authorization grant
/// (a [`FileCapability::resolve`] refusal is filesystem policy, asserted in
/// `tests/directory_enumeration.rs`) and Windows case-insensitive path comparison.
#[derive(Debug, Clone)]
pub struct MemoryWalkSource {
    root: String,
    rows: Vec<MemoryRow>,
    unreadable: Vec<String>,
}

impl MemoryWalkSource {
    /// Builds the tree under `root` from `root`-relative rows. Spec order is irrelevant: a listing sorts.
    #[must_use]
    pub fn new(root: &str, spec: &[(&str, MemoryKind, u64)]) -> Self {
        let root = normalize_separators(root);
        let rows = spec
            .iter()
            .map(|(relative, kind, size)| {
                let path = join_paths(&[&root, &normalize_separators(relative)]);
                MemoryRow {
                    name: split_path(&path).1.to_string(),
                    path,
                    kind: *kind,
                    size: if *kind == MemoryKind::Directory { 0 } else { *size },
                }
            })
            .collect();
        Self { root, rows, unreadable: Vec::new() }
    }

    /// Marks directories whose listing must fail — the mid-walk I/O error [`Self::list`] cannot otherwise
    /// reach, because nothing here touches a device.
    #[must_use]
    pub fn unreadable(mut self, paths: &[&str]) -> Self {
        self.unreadable.extend(paths.iter().map(|path| join_paths(&[&self.root, path])));
        self
    }

    /// The absolute spelling of one `root`-relative row, as a listing would hand it back.
    #[must_use]
    pub fn path_of(&self, relative: &str) -> String {
        join_paths(&[&self.root, &normalize_separators(relative)])
    }
}

impl WalkSource for MemoryWalkSource {
    fn list(&self, path: &str) -> Result<Vec<DirEntryInfo>, FsCapabilityError> {
        let spelled = normalize_separators(path);
        if self.unreadable.contains(&spelled) {
            return Err(FsCapabilityError::host(
                "list_failed",
                format!("{spelled} was told to be unlistable"),
            ));
        }
        let mut entries: Vec<DirEntryInfo> = self
            .rows
            .iter()
            .filter(|row| split_path(&row.path).0 == spelled)
            .map(|row| DirEntryInfo {
                name: row.name.clone(),
                path: join_paths(&[&spelled, &row.name]),
                is_file: row.kind == MemoryKind::File,
                is_directory: row.kind == MemoryKind::Directory,
                is_symlink: row.kind == MemoryKind::Symlink,
            })
            .collect();
        if entries.is_empty() {
            // Either nothing was ever here, or the path is a leaf the walk should not have asked about.
            return Err(match self.rows.iter().find(|row| row.path == spelled) {
                Some(_) => FsCapabilityError::host("list_failed", format!("{spelled} is not a directory")),
                None => FsCapabilityError::NotFound,
            });
        }
        entries.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(entries)
    }

    fn size(&self, path: &str) -> Result<u64, FsCapabilityError> {
        let spelled = normalize_separators(path);
        // A path the tree lost since its listing answers `Ok(0)`, which is [`FileCapability`]'s shape too:
        // `stat` reports `exists: false` with `size_bytes: 0` instead of failing.
        Ok(self
            .rows
            .iter()
            .find(|row| row.path == spelled)
            .map_or(0, |row| row.size))
    }
}
