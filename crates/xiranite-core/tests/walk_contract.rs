//! The host walk's contract (ADR-0072), asserted once and run against **every** [`WalkSource`].
//!
//! Why the shape is a contract and not just disk tests: order, the ceilings, the per-directory boundary
//! and "refuse rather than hand over half a tree" are properties of the seam, so they must hold for
//! whichever implementation answers. Both runs are fed the *same* `TREE` spec — the disk fixture writes
//! those rows, the memory source is built from them — so the two cannot drift into two different trees.
//!
//! The disk run covers what only a disk can prove (real `readdir` kinds, real byte sizes, the grant). The
//! memory run covers what a disk cannot prove the same way on every host: a symlink row, because creating
//! one needs a privilege Windows does not grant by default, and a directory that turns unlistable mid-walk.
//! Those two cases are named `memory_only_…` below so nobody reads them as disk-verified.

use std::path::Path;

use xiranite_core::enumeration::{
    Boundary, Ceiling, LISTING_SEPARATOR, ListingHeader, MemoryKind, MemoryWalkSource, WalkGate,
    WalkOutcome, WalkRequest, WalkSource, WalkState, parse_listing, walk,
};
use xiranite_core::filesystem::{FileCapability, join_paths, normalize_separators};

/// The tree both sources walk, as `root`-relative rows plus the byte size a sized listing must report.
///
/// Deliberately not in name order and not in DFS order: a source that forgets to sort, or a walk that
/// forgets to descend before its next sibling, has to show up as a wrong listing.
const TREE: &[(&str, MemoryKind, u64)] = &[
    ("b.zip", MemoryKind::File, 7),
    ("a.zip", MemoryKind::File, 4),
    ("artist", MemoryKind::Directory, 0),
    ("artist/one.zip", MemoryKind::File, 2),
    ("artist/deep", MemoryKind::Directory, 0),
    ("artist/deep/two.zip", MemoryKind::File, 1),
    ("notes.txt", MemoryKind::File, 3),
];

/// The rows a walk over [`TREE`] must emit, hand-written rather than computed: depth-first, sorted inside
/// each directory, a directory's whole subtree before its next sibling, and the root itself not a row.
const EXPECTED: &[&str] = &[
    "a.zip",
    "artist",
    "artist/deep",
    "artist/deep/two.zip",
    "artist/one.zip",
    "b.zip",
    "notes.txt",
];

/// `d` for the two directories, `f` for the five files, in [`EXPECTED`] order.
const EXPECTED_KINDS: [char; 7] = ['f', 'd', 'd', 'f', 'f', 'f', 'f'];

/// `root`, `artist`, `artist/deep`.
const EXPECTED_DIRECTORIES: usize = 3;

/// The byte each file row carries when the node asks for sizes.
fn expected_size(relative: &str) -> u64 {
    TREE.iter()
        .find(|(path, _kind, _size)| *path == relative)
        .map(|(_path, _kind, size)| *size)
        .expect("every expected row is in the spec")
}

/// A gate that answers `Enter` and counts the boundaries it was asked about.
struct CountingGate {
    calls: usize,
}

impl WalkGate for CountingGate {
    fn at_directory(&mut self, _state: &WalkState) -> Boundary {
        self.calls += 1;
        Boundary::Enter
    }
}

/// The `(relative path, kind, size)` triples one outcome carries.
///
/// Stripping the root prefix is also the assertion that a source keeps **the caller's own spelling** of
/// the root: a row that does not start with `{root}/` panics here, which is what catches a source that
/// published a canonicalized `/private/var/...` prefix the caller never asked for.
fn rows(outcome: &WalkOutcome, root: &str) -> Vec<(String, char, Option<u64>)> {
    let WalkOutcome::Listing(walked) = outcome else {
        panic!("expected a listing, got {outcome:?}");
    };
    let (_header, entries) = parse_listing(&walked.listing).expect("a document the walk itself encoded");
    entries
        .iter()
        .map(|entry| {
            let relative = entry
                .path
                .strip_prefix(&format!("{root}/"))
                .unwrap_or_else(|| panic!("{:?} is not spelled under {root}/", entry.path));
            (relative.to_string(), if entry.is_directory { 'd' } else { 'f' }, entry.size)
        })
        .collect()
}

/// The assertions every [`WalkSource`] owes a walk. One body, run twice below.
fn assert_walk_contract(source: &dyn WalkSource, root: &str) {
    let mut gate = CountingGate { calls: 0 };
    let outcome = walk(source, &mut gate, &WalkRequest::new([root]));
    let walked = match &outcome {
        WalkOutcome::Listing(walked) => walked,
        other => panic!("the tree is walkable, got {other:?}"),
    };

    // 1. Shape and order: seven rows in the sequence the guest walk produced, three directories.
    let got: Vec<String> = rows(&outcome, root).into_iter().map(|(path, _, _)| path).collect();
    let wanted: Vec<String> = EXPECTED.iter().map(|relative| (*relative).to_string()).collect();
    assert_eq!(got, wanted, "a walk that stopped at one level would miss artist/deep");
    assert_eq!(walked.entry_count, EXPECTED.len());
    assert_eq!(walked.directory_count, EXPECTED_DIRECTORIES);
    assert_eq!(
        rows(&outcome, root).into_iter().map(|(_, kind, _)| kind).collect::<Vec<_>>(),
        EXPECTED_KINDS.to_vec(),
        "the kinds are what the nodes plan on"
    );

    // 2. Boundary cadence: ADR-0072 asks once per directory, never once per entry.
    assert_eq!(
        gate.calls, walked.directory_count,
        "one boundary per directory listed; the five files ask for none"
    );

    // 3. The cheap shape is the default: no sizes, and every line is exactly `path<TAB>kind`.
    let (header, entries) = parse_listing(&walked.listing).expect("the document parses");
    assert_eq!(header, ListingHeader { roots: 1, sizes: false });
    assert!(
        entries.iter().all(|entry| entry.size.is_none()),
        "the default never asks the source for a size: {entries:?}"
    );
    let lines: Vec<&str> = walked.listing.lines().skip(1).filter(|line| !line.is_empty()).collect();
    assert!(
        lines.iter().all(|line| line.split(LISTING_SEPARATOR).count() == 2),
        "without sizes every line is two fields: {lines:?}"
    );

    // 4. A node that asks for sizes gets the bytes, and a directory still carries `0`.
    let sized = walk(
        source,
        &mut CountingGate { calls: 0 },
        &WalkRequest { want_sizes: true, ..WalkRequest::new([root]) },
    );
    let WalkOutcome::Listing(sized_walk) = &sized else {
        panic!("a sized walk over the same tree must still list: {sized:?}");
    };
    let (sized_header, _) = parse_listing(&sized_walk.listing).expect("a sized document parses");
    assert!(sized_header.sizes, "the header says what the lines carry");
    for (relative, kind, size) in rows(&sized, root) {
        assert_eq!(
            size,
            Some(if kind == 'd' { 0 } else { expected_size(&relative) }),
            "{relative} ({kind}) carries the size the spec says"
        );
    }

    // 5. A ceiling refuses; it never truncates the document. Spelling-independent limits only.
    let squeezed = walk(
        source,
        &mut CountingGate { calls: 0 },
        &WalkRequest { max_entries: 2, ..WalkRequest::new([root]) },
    );
    assert_eq!(
        squeezed,
        WalkOutcome::Refused(Ceiling { which: "entries", limit: 2, seen: 2 }),
        "the walk stops on the limit instead of shipping half a plan"
    );
    let starved = walk(
        source,
        &mut CountingGate { calls: 0 },
        &WalkRequest { max_listing_bytes: 1, ..WalkRequest::new([root]) },
    );
    assert_eq!(
        starved,
        WalkOutcome::Refused(Ceiling { which: "listing_bytes", limit: 1, seen: 0 }),
        "the byte ceiling trips on the first line, before anything is written"
    );

    // 6. A directory that cannot be listed fails the walk instead of dropping a subtree.
    let missing = join_paths(&[root, "artist/absent"]);
    let failed = walk(source, &mut CountingGate { calls: 0 }, &WalkRequest::new([missing.as_str()]));
    assert!(
        matches!(failed, WalkOutcome::Failed(_)),
        "an unlistable root must be a failure, not zero entries: {failed:?}"
    );
}

/// Writes [`TREE`] under `dir`, so the disk run walks the same tree the memory run holds.
fn write_tree(dir: &Path) {
    for (relative, kind, size) in TREE {
        let path = dir.join(relative);
        match kind {
            MemoryKind::Directory => std::fs::create_dir_all(&path).expect("fixture directory"),
            _ => {
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).expect("fixture parent");
                }
                std::fs::write(&path, vec![b'x'; usize::try_from(*size).expect("small fixture size")])
                    .expect("fixture file");
            }
        }
    }
}

#[test]
fn memory_source_satisfies_the_walk_contract() {
    assert_walk_contract(&MemoryWalkSource::new("/tree", TREE), "/tree");
}

#[test]
fn file_capability_satisfies_the_walk_contract() {
    let staging = tempfile::TempDir::new().expect("a staging directory");
    write_tree(staging.path());
    // The walk hands back the caller's own spelling, so the expectations use it too. `FileCapability::list`
    // canonicalizes the *grant* but not the emitted path, which is why this is the temp path and not its
    // `/private/var/...` target on macOS.
    let root = normalize_separators(&staging.path().to_string_lossy());
    let files = FileCapability::new([staging.path()]);
    assert_walk_contract(&files, &root);
}

/// The property ADR-0072 keeps from `samea`'s and `classq`'s guest walks: a link is a leaf.
///
/// The positive control is the identical spec with that row as a directory — if the walk descended into
/// anything that is not `is_directory`, the control and the case would be indistinguishable.
#[test]
fn memory_only_a_symlink_row_is_emitted_and_never_descended() {
    let spec = [
        ("readme.md", MemoryKind::File, 3),
        ("link", MemoryKind::Symlink, 0),
        ("link/inside.zip", MemoryKind::File, 9),
    ];
    let outcome = walk(
        &MemoryWalkSource::new("/tree", &spec),
        &mut CountingGate { calls: 0 },
        &WalkRequest::new(["/tree"]),
    );
    let paths: Vec<String> = rows(&outcome, "/tree").into_iter().map(|(path, _, _)| path).collect();
    assert_eq!(paths, vec!["link".to_string(), "readme.md".to_string()]);
    assert_eq!(
        rows(&outcome, "/tree")[0].1,
        'f',
        "a link is reported as a leaf, so the walk cannot loop on a link cycle"
    );

    let as_directory = [
        ("readme.md", MemoryKind::File, 3),
        ("link", MemoryKind::Directory, 0),
        ("link/inside.zip", MemoryKind::File, 9),
    ];
    let walked = walk(
        &MemoryWalkSource::new("/tree", &as_directory),
        &mut CountingGate { calls: 0 },
        &WalkRequest::new(["/tree"]),
    );
    let control: Vec<String> = rows(&walked, "/tree").into_iter().map(|(path, _, _)| path).collect();
    assert_eq!(
        control,
        vec!["link".to_string(), "link/inside.zip".to_string(), "readme.md".to_string()],
        "the same row as a directory does descend: the flag is what stopped the link"
    );
}

/// A plan that quietly lost a branch is indistinguishable from a complete one, so the walk fails.
#[test]
fn memory_only_an_unlistable_directory_mid_walk_fails_instead_of_losing_a_subtree() {
    let source = MemoryWalkSource::new("/tree", TREE).unreadable(&["artist"]);
    let outcome = walk(&source, &mut CountingGate { calls: 0 }, &WalkRequest::new(["/tree"]));
    let WalkOutcome::Failed(error) = &outcome else {
        panic!("a subtree that could not be listed must fail the walk: {outcome:?}");
    };
    assert_eq!(error.code(), "list_failed");

    // Control: the untouched source walks the identical tree, so the failure is the blocked directory.
    let clean = walk(
        &MemoryWalkSource::new("/tree", TREE),
        &mut CountingGate { calls: 0 },
        &WalkRequest::new(["/tree"]),
    );
    let WalkOutcome::Listing(walked) = clean else { panic!("the control tree is walkable") };
    assert_eq!(walked.entry_count, EXPECTED.len());
}

/// [`WalkSource::size`] answers `0` for a path the listing no longer has, because that is `stat`'s
/// `exists: false` shape and the walk must not fail an operation over a file deleted mid-scan.
#[test]
fn memory_only_a_path_lost_between_listing_and_size_still_gets_a_row() {
    let source = MemoryWalkSource::new("/tree", TREE);
    assert_eq!(source.size("/tree/a.zip").expect("a known row"), 4);
    assert_eq!(
        source.size("/tree/gone.zip").expect("a vanished row is not an error"),
        0,
        "the vanished path answers the way FileCapability::stat reports exists: false"
    );

    let outcome = walk(
        &source,
        &mut CountingGate { calls: 0 },
        &WalkRequest { want_sizes: true, ..WalkRequest::new(["/tree"]) },
    );
    assert_eq!(
        rows(&outcome, "/tree").iter().filter(|(_, kind, _)| *kind == 'f').count(),
        5,
        "a sized walk still emits every file: {outcome:?}"
    );
}
