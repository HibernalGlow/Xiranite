//! `buildSameaPlan` (`core.ts:128-167`), `collectArchives` (`core.ts:171-198`), `buildGroups`
//! (`core.ts:200-210`) and `summarize` (`core.ts:226-239`).
//!
//! The scan is the node: walk each authorized root, read the artist out of every archive name, count the
//! artists, then decide per entry whether a move is ready, ignored, skipped or a conflict. Nothing here
//! knows about Extism, WASI or JSON — only [`crate::fs_surface::SameaFileSystem`].
//!
//! ## Deviations, and why each is allowed
//!
//! * **The recursion became an explicit frame stack.** `core.ts:186` recursed per directory, so a symlink
//!   loop (or a genuinely deep library) grew the JavaScript stack; in a WASM isolate it grows the guest
//!   stack instead and traps, which ADR-0068 forbids as an answer. The frames are heap-allocated and the
//!   visit order is identical: at a directory the entries are taken in listing order and a subdirectory
//!   expands in place, exactly where `core.ts:186` expanded it.
//! * **Checkpoints are new.** `core.ts` had no yield point because its host cancelled by dropping the
//!   worker; ADR-0066 makes the plugin cooperate, so every directory listing costs one
//!   `xiranite.operation.checkpoint` and a `Cancelled` answer stops the scan
//!   ([`SameaPlanError::Cancelled`]).
//! * **Group order is a documented stand-in for ICU `localeCompare`** (`core.ts:209`). Counts still sort
//!   first; only the tie-break among equally frequent artists differs (case-folded, then byte order), and
//!   `data.groups` ordering is display-only — the per-item lookup that decides a verdict matches on
//!   `key`, not on position.
//! * **Listing order is the filesystem's.** `platform.ts:11` used `readdir`, which has no defined order;
//!   [`crate::fs_runtime`] sorts by name so a run reproduces itself, and the parity tests use
//!   [`crate::memory_fs::MemoryFileSystem`], which keeps the order they declare.

use std::collections::BTreeMap;

use crate::artist::{
    ArtistMatch, Blacklists, PatternList, extract_artist, is_archive, is_artist_group_directory,
};
use crate::contract::{
    SameaArtistGroup, SameaData, SameaDirEntry, SameaGroupStatus, SameaPlanItem, SameaPlanStatus,
};
use crate::fs_surface::{SameaFileSystem, SameaIoError, SameaRunControl};
use crate::input::NormalizedSameaInput;
use crate::path_tools::{normalize_path, path_basename, path_join};

/// The folder `centralize` gathers under (`core.ts:205`), which is also a default path-blacklist entry
/// (`core.ts:77`).
pub const CENTRALIZE_FOLDER: &str = "[00画师分类]";
/// The phase a scan checkpoint reports under.
pub const PHASE_SCANNING: &str = "scanning";
/// The phase an apply-loop checkpoint reports under.
pub const PHASE_ORGANIZING: &str = "organizing";

/// The scan reasons, spelled exactly as `core.ts` puts them into `ignored` and `reason`.
mod reasons {
    pub const ROOT_NOT_DIRECTORY: &str = "root_not_directory";
    pub const PATH_BLACKLISTED: &str = "path_blacklisted";
    pub const ARTIST_BLACKLISTED: &str = "artist_blacklisted";
    pub const ARTIST_NOT_DETECTED: &str = "artist_not_detected";
    pub const BELOW_MIN_OCCURRENCES: &str = "below_min_occurrences";
    pub const SAME_PATH: &str = "same_path";
    pub const TARGET_EXISTS: &str = "target_exists";
}

/// Why a plan could not be built at all.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SameaPlanError {
    /// A directory listing failed, which `core.ts:174`'s `await runtime.listDir` surfaced as a rejection
    /// and `runSamea`'s `catch` (`core.ts:123`) turned into the failed run.
    Io(SameaIoError),
    /// `xiranite.operation.checkpoint` answered `Cancelled` (ADR-0066). No TypeScript counterpart.
    Cancelled,
}

impl SameaPlanError {
    /// The message the run reports.
    #[must_use]
    pub fn message(&self) -> String {
        match self {
            Self::Io(error) => error.message.clone(),
            Self::Cancelled => "operation cancelled".to_string(),
        }
    }
}

impl From<SameaIoError> for SameaPlanError {
    fn from(error: SameaIoError) -> Self {
        Self::Io(error)
    }
}

/// One collected entry: the tuple shape of `core.ts:129`.
#[derive(Debug, Clone)]
pub struct CollectedEntry {
    /// The root this entry was found under (`core.ts:133`, `core.ts:203`).
    pub root_path: String,
    /// The directory entry itself.
    pub entry: SameaDirEntry,
    /// What `extractArtist` read out of the name.
    pub artist: Option<ArtistMatch>,
    /// `core.ts:129`'s `ignored`, which is both the verdict and the `reason` text.
    pub ignored: Option<String>,
}

impl CollectedEntry {
    /// The item `core.ts:144-165` appends: source and identity from the entry, verdict from the caller.
    fn plan(&self, target_path: String, status: SameaPlanStatus, reason: Option<&str>) -> SameaPlanItem {
        SameaPlanItem {
            root_path: self.root_path.clone(),
            source_path: self.entry.path.clone(),
            target_path,
            source_name: self.entry.name.clone(),
            artist_key: self.artist.as_ref().map(|artist| artist.key.clone()).unwrap_or_default(),
            artist_name: self.artist.as_ref().map(|artist| artist.label.clone()).unwrap_or_default(),
            status,
            reason: reason.map(str::to_string),
        }
    }
}

/// The scan half of a run: build the plan, decide nothing else.
pub fn build_samea_plan(
    input: &NormalizedSameaInput,
    file_system: &mut dyn SameaFileSystem,
    control: &mut dyn SameaRunControl,
) -> Result<SameaData, SameaPlanError> {
    let patterns = PatternList::new(&input.regex_blacklist);
    let blacklists =
        Blacklists { artist: &input.artist_blacklist, path: &input.path_blacklist, patterns: &patterns };

    let mut entries: Vec<CollectedEntry> = Vec::new();
    for root in &input.paths {
        let info = file_system.path_info(root);
        if !info.exists || !info.is_directory {
            // `core.ts:133`: the root itself becomes one error item and nothing is scanned.
            entries.push(CollectedEntry {
                root_path: root.clone(),
                entry: SameaDirEntry {
                    name: path_basename(root),
                    path: root.clone(),
                    is_file: false,
                    is_directory: false,
                },
                artist: None,
                ignored: Some(reasons::ROOT_NOT_DIRECTORY.to_string()),
            });
            continue;
        }
        collect_archives(root, root, input, &blacklists, file_system, control, &mut entries)?;
    }

    // `core.ts:140`: one count per artist key, across every root, ignoring blacklisted-path entries.
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for item in &entries {
        if let (Some(artist), None) = (&item.artist, &item.ignored) {
            *counts.entry(artist.key.as_str()).or_insert(0) += 1;
        }
    }

    let groups = build_groups(&entries, &counts, input);
    let scanned_count = entries
        .iter()
        .filter(|entry| entry.ignored.as_deref() != Some(reasons::ROOT_NOT_DIRECTORY))
        .count();

    let items: Vec<SameaPlanItem> =
        entries.iter().map(|entry| plan_item_for(entry, &groups, file_system)).collect();

    Ok(summarize(input, items, groups, scanned_count))
}

#[allow(clippy::too_many_arguments, reason = "the scan needs root, directory, rules and sinks together")]
fn collect_archives(
    root: &str,
    directory: &str,
    input: &NormalizedSameaInput,
    blacklists: &Blacklists<'_>,
    file_system: &mut dyn SameaFileSystem,
    control: &mut dyn SameaRunControl,
    out: &mut Vec<CollectedEntry>,
) -> Result<(), SameaPlanError> {
    // `core.ts:172`: a blacklisted directory contributes nothing at all, entries included.
    if !input.ignore_path_blacklist && blacklists.path_hit(directory) {
        return Ok(());
    }

    struct Frame {
        entries: Vec<SameaDirEntry>,
        index: usize,
    }

    let root_listing = file_system.list_dir(directory)?;
    if control.checkpoint(PHASE_SCANNING, out.len(), out.len() + root_listing.len()).is_hard_stop() {
        return Err(SameaPlanError::Cancelled);
    }
    let mut stack: Vec<Frame> = vec![Frame { entries: root_listing, index: 0 }];

    while !stack.is_empty() {
        // Take one entry, then release the borrow on the frame: a directory discovered here pushes a new
        // frame, which the borrow checker would otherwise refuse.
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

        if entry.is_directory {
            if input.skip_grouped_directories && is_artist_group_directory(&entry.name) {
                continue;
            }
            if input.include_directories {
                // `core.ts:177-184`: with `includeDirectories` a first-level directory *is* the work item.
                if !input.ignore_path_blacklist && blacklists.path_hit(&entry.path) {
                    out.push(CollectedEntry {
                        root_path: root.to_string(),
                        entry,
                        artist: None,
                        ignored: Some(reasons::PATH_BLACKLISTED.to_string()),
                    });
                    continue;
                }
                let artist = extract_artist(&entry.name, blacklists);
                let ignored = blacklisted_ignored(artist.as_ref(), blacklists);
                out.push(CollectedEntry { root_path: root.to_string(), entry, artist, ignored });
                continue;
            }
            if !input.ignore_path_blacklist && blacklists.path_hit(&entry.path) {
                continue;
            }
            let listing = file_system.list_dir(&entry.path)?;
            if control.checkpoint(PHASE_SCANNING, out.len(), out.len() + listing.len()).is_hard_stop() {
                return Err(SameaPlanError::Cancelled);
            }
            stack.push(Frame { entries: listing, index: 0 });
            continue;
        }

        // `core.ts:189`: only files whose name ends in an authorized extension are candidates.
        if !entry.is_file || !is_archive(&entry.name, &input.archive_extensions) {
            continue;
        }
        if !input.ignore_path_blacklist && blacklists.path_hit(&entry.path) {
            out.push(CollectedEntry {
                root_path: root.to_string(),
                entry,
                artist: None,
                ignored: Some(reasons::PATH_BLACKLISTED.to_string()),
            });
            continue;
        }
        let artist = extract_artist(&entry.name, blacklists);
        let ignored = blacklisted_ignored(artist.as_ref(), blacklists);
        out.push(CollectedEntry { root_path: root.to_string(), entry, artist, ignored });
    }

    Ok(())
}

/// `core.ts:183`/`core.ts:195`: an entry whose artist *label* is blacklisted is marked ignored.
fn blacklisted_ignored(artist: Option<&ArtistMatch>, blacklists: &Blacklists<'_>) -> Option<String> {
    if artist.is_some_and(|matched| blacklists.artist_hit(&matched.label)) {
        Some(reasons::ARTIST_BLACKLISTED.to_string())
    } else {
        None
    }
}

/// `buildGroups` (`core.ts:200-210`): one group per `(root, artist)` pair, first occurrence wins.
fn build_groups(
    entries: &[CollectedEntry],
    counts: &BTreeMap<&str, usize>,
    input: &NormalizedSameaInput,
) -> Vec<SameaArtistGroup> {
    let mut declared: Vec<String> = Vec::new();
    let mut groups: Vec<SameaArtistGroup> = Vec::new();
    for entry in entries {
        let Some(artist) = &entry.artist else { continue };
        // `core.ts:203`: the map key is the root *and* the artist key, joined on a NUL.
        let composite = format!("{}\0{}", entry.root_path, artist.key);
        if declared.iter().any(|candidate| candidate == &composite) {
            continue;
        }
        declared.push(composite);

        let count = counts.get(artist.key.as_str()).copied().unwrap_or(0);
        let base =
            if input.centralize { path_join(&[&entry.root_path, CENTRALIZE_FOLDER]) } else { entry.root_path.clone() };
        let status = if entry.ignored.as_deref() == Some(reasons::ARTIST_BLACKLISTED) {
            SameaGroupStatus::Blacklisted
        } else if count >= input.min_occurrences {
            SameaGroupStatus::Ready
        } else {
            SameaGroupStatus::BelowThreshold
        };
        groups.push(SameaArtistGroup {
            key: artist.key.clone(),
            name: artist.label.clone(),
            target_dir: path_join(&[&base, &artist.label]),
            count,
            status,
        });
    }
    groups.sort_by(|left, right| {
        right.count.cmp(&left.count).then_with(|| compare_group_names(&left.name, &right.name))
    });
    groups
}

/// `core.ts:143-165`'s per-entry verdict.
fn plan_item_for(
    entry: &CollectedEntry,
    groups: &[SameaArtistGroup],
    file_system: &mut dyn SameaFileSystem,
) -> SameaPlanItem {
    if let Some(ignored) = &entry.ignored {
        let status = if ignored == reasons::ROOT_NOT_DIRECTORY {
            SameaPlanStatus::Error
        } else {
            SameaPlanStatus::Ignored
        };
        return entry.plan(entry.entry.path.clone(), status, Some(ignored));
    }

    let Some(artist) = &entry.artist else {
        return entry.plan(
            entry.entry.path.clone(),
            SameaPlanStatus::Ignored,
            Some(reasons::ARTIST_NOT_DETECTED),
        );
    };

    // `core.ts:153`: the group must belong to this item's own root, decided by a string prefix.
    let group = groups
        .iter()
        .find(|candidate| candidate.key == artist.key && candidate.target_dir.starts_with(&entry.root_path));

    let Some(ready) = group.filter(|candidate| candidate.status == SameaGroupStatus::Ready) else {
        // `core.ts:155`: a blacklisted group says so; every other verdict — including "no group for this
        // root" — reports the threshold.
        let reason = match group.map(|candidate| candidate.status) {
            Some(SameaGroupStatus::Blacklisted) => reasons::ARTIST_BLACKLISTED,
            _ => reasons::BELOW_MIN_OCCURRENCES,
        };
        return entry.plan(entry.entry.path.clone(), SameaPlanStatus::Ignored, Some(reason));
    };

    let target_path = path_join(&[&ready.target_dir, &entry.entry.name]);
    if normalize_path(&target_path) == normalize_path(&entry.entry.path) {
        return entry.plan(target_path, SameaPlanStatus::Skipped, Some(reasons::SAME_PATH));
    }

    let target = file_system.path_info(&target_path);
    if target.exists {
        entry.plan(target_path, SameaPlanStatus::Conflict, Some(reasons::TARGET_EXISTS))
    } else {
        // `core.ts:164` leaves `reason` unset for a ready item, and `JSON.stringify` drops the key.
        entry.plan(target_path, SameaPlanStatus::Ready, None)
    }
}

/// `summarize` (`core.ts:226-239`), including the `errors` projection over error **and** conflict items.
#[must_use]
pub fn summarize(
    input: &NormalizedSameaInput,
    items: Vec<SameaPlanItem>,
    groups: Vec<SameaArtistGroup>,
    scanned_count: usize,
) -> SameaData {
    let errors: Vec<String> = items
        .iter()
        .filter(|item| item.status == SameaPlanStatus::Error || item.status == SameaPlanStatus::Conflict)
        .map(|item| {
            format!("{}: {}", item.source_path, item.reason.as_deref().unwrap_or(item.status.as_str()))
        })
        .collect();
    let count = |status: SameaPlanStatus| items.iter().filter(|item| item.status == status).count();

    SameaData {
        action: input.action.clone(),
        centralize: input.centralize,
        min_occurrences: input.min_occurrences,
        detected_count: items.iter().filter(|item| !item.artist_key.is_empty()).count(),
        ready_count: count(SameaPlanStatus::Ready),
        moved_count: count(SameaPlanStatus::Moved),
        ignored_count: count(SameaPlanStatus::Ignored),
        skipped_count: count(SameaPlanStatus::Skipped),
        conflict_count: count(SameaPlanStatus::Conflict),
        error_count: count(SameaPlanStatus::Error),
        items,
        groups,
        scanned_count,
        errors,
    }
}

/// `left.name.localeCompare(right.name)` (`core.ts:209`), as a total order.
fn compare_group_names(left: &str, right: &str) -> std::cmp::Ordering {
    left.to_lowercase().cmp(&right.to_lowercase()).then_with(|| left.cmp(right))
}
