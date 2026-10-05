//! ADR-0072: recursive enumeration is host work, and the host walk owes the operation a pause/cancel
//! boundary at every directory plus the progress event the guest used to report.
//!
//! Every guard here has the pair that proves the guard is what stops it: a walk that succeeds on the same
//! tree, or a wait that must be observed to have run.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use xiranite_core::enumeration::{
    Boundary, Ceiling, DEFAULT_MAX_ENTRIES, LISTING_PROTOCOL, LISTING_SEPARATOR, ListingHeader,
    PhaseGate, ReportingGate, WalkGate, WalkOutcome, WalkRequest, WalkState, parse_listing, walk,
};
use xiranite_core::filesystem::FileCapability;
use xiranite_core::{OperationManager, OperationManagerOptions, OperationPhase};

struct TempRoot {
    root: PathBuf,
}

impl TempRoot {
    /// `root/{a.zip, artist/{deep/two.zip, one.zip}, b.zip}` — three directories, five entries, and a
    /// nested file so a walk that stops after one level cannot produce the same listing.
    fn new(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!("xiranite-enumeration-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("artist/deep")).expect("fixture dirs");
        std::fs::write(root.join("a.zip"), b"1234").expect("fixture a.zip");
        std::fs::write(root.join("b.zip"), b"1234567").expect("fixture b.zip");
        std::fs::write(root.join("artist/one.zip"), b"12").expect("fixture one.zip");
        std::fs::write(root.join("artist/deep/two.zip"), b"1").expect("fixture two.zip");
        Self { root }
    }

    fn path(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    /// The tree as a host walk must emit it: sorted within a directory, and a directory's whole subtree
    /// emitted before its next sibling — the exact order `samea`'s and `classq`'s guest frames produced.
    fn expected_paths(&self) -> Vec<String> {
        [
            "a.zip",
            "artist",
            "artist/deep",
            "artist/deep/two.zip",
            "artist/one.zip",
            "b.zip",
        ]
        .into_iter()
        .map(|suffix| self.root.join(suffix).to_string_lossy().into_owned())
        .collect()
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn capability(root: &Path) -> FileCapability {
    FileCapability::new([root])
}

/// A gate that always says enter, for the tests about shape rather than about pause.
struct EnterAlways;

impl WalkGate for EnterAlways {
    fn at_directory(&mut self, _state: &WalkState) -> Boundary {
        Boundary::Enter
    }
}

/// The `(path, kind)` pairs one walk emitted, in order.
fn walked_pairs(outcome: &WalkOutcome) -> Vec<(String, char)> {
    let WalkOutcome::Listing(walked) = outcome else {
        panic!("expected a listing, got {outcome:?}");
    };
    let (_header, entries) = parse_listing(&walked.listing).expect("a listing the walk itself encoded");
    entries
        .iter()
        .map(|entry| (entry.path.clone(), if entry.is_directory { 'd' } else { 'f' }))
        .collect()
}

#[test]
fn a_walk_emits_the_whole_tree_in_the_order_the_guest_walk_produced() {
    let root = TempRoot::new("order");
    let files = capability(&root.root);
    let outcome = walk(&files, &mut EnterAlways, &WalkRequest::new([root.path()]));

    let paths: Vec<String> = walked_pairs(&outcome)
        .into_iter()
        .map(|(path, _)| path)
        .collect();
    assert_eq!(paths, root.expected_paths(), "a walk that stopped at one level would miss artist/deep");
    let WalkOutcome::Listing(walked) = &outcome else { unreachable!() };
    assert_eq!(walked.entry_count, 6);
    assert_eq!(walked.directory_count, 3, "root, artist, artist/deep");
    // The kinds are the shape the nodes plan on: files are `f`, the three directories are `d`.
    assert_eq!(
        walked_pairs(&outcome).into_iter().collect::<Vec<_>>(),
        vec![
            (root.expected_paths()[0].clone(), 'f'),
            (root.expected_paths()[1].clone(), 'd'),
            (root.expected_paths()[2].clone(), 'd'),
            (root.expected_paths()[3].clone(), 'f'),
            (root.expected_paths()[4].clone(), 'f'),
            (root.expected_paths()[5].clone(), 'f'),
        ]
    );
}

#[test]
fn a_listing_round_trips_through_the_decoder_with_its_header() {
    let root = TempRoot::new("round-trip");
    let files = capability(&root.root);
    let WalkOutcome::Listing(walked) = walk(&files, &mut EnterAlways, &WalkRequest::new([root.path()]))
    else {
        panic!("the walk should produce a listing");
    };

    let (header, entries) = parse_listing(&walked.listing).expect("the document parses");
    assert_eq!(header, ListingHeader { roots: 1, sizes: false });
    assert_eq!(entries.len(), 6);
    assert!(
        walked.listing.starts_with(&format!("{LISTING_PROTOCOL}{LISTING_SEPARATOR}roots=1")),
        "the version tag is the first field of the first line: {}",
        walked.listing.lines().next().unwrap_or_default()
    );
    // Positive control for the decoder: the walk's own entry count agrees with what parses back.
    assert_eq!(walked.entry_count, entries.len());
}

#[test]
fn size_is_carried_only_when_the_node_asks_for_it() {
    let root = TempRoot::new("sizes");
    let files = capability(&root.root);
    let asked = WalkRequest { want_sizes: true, ..WalkRequest::new([root.path()]) };

    let cheap = walk(&files, &mut EnterAlways, &WalkRequest::new([root.path()]));
    let WalkOutcome::Listing(cheap) = cheap else { panic!("cheap walk should list") };
    let (_, cheap_entries) = parse_listing(&cheap.listing).expect("cheap parses");
    assert!(
        cheap_entries.iter().all(|entry| entry.size.is_none()),
        "the default shape never stats: {:?}",
        cheap_entries
    );
    let cheap_lines: Vec<&str> =
        cheap.listing.lines().skip(1).filter(|line| !line.is_empty()).collect();
    assert!(
        cheap_lines.iter().all(|line| line.split(LISTING_SEPARATOR).count() == 2),
        "without sizes every line is exactly `name<TAB>type`: {cheap_lines:?}"
    );

    let with_sizes = walk(&files, &mut EnterAlways, &asked);
    let WalkOutcome::Listing(sizeable) = with_sizes else { panic!("sized walk should list") };
    let (header, size_entries) = parse_listing(&sizeable.listing).expect("sized parses");
    assert!(header.sizes, "the header says what the lines carry");
    let b_zip = root.root.join("b.zip").to_string_lossy().into_owned();
    let found = size_entries
        .iter()
        .find(|entry| entry.path == b_zip)
        .expect("b.zip is in the listing");
    assert_eq!(found.size, Some(7), "the size the fixture was written with");
}

/// A gate that pauses the operation at one boundary and otherwise defers to production's [`PhaseGate`].
/// The park/abort decision stays in `PhaseGate` — duplicating it here would test the test.
struct PauseAtBoundary<'a> {
    manager: &'a OperationManager,
    operation_id: &'a str,
    /// The 1-based boundary that pauses.
    at: usize,
    seen: usize,
    inner: PhaseGate<'a>,
}

impl WalkGate for PauseAtBoundary<'_> {
    fn at_directory(&mut self, state: &WalkState) -> Boundary {
        self.seen += 1;
        if self.seen == self.at {
            self.manager.pause(self.operation_id).expect("a running operation pauses");
        }
        self.inner.at_directory(state)
    }
}

#[test]
fn a_pause_parks_the_walk_at_a_directory_boundary_and_a_resume_lets_it_finish() {
    let root = TempRoot::new("pause");
    let files = capability(&root.root);
    let manager = OperationManager::new(OperationManagerOptions::default());
    let control = manager.start("samea", None, None);
    let operation_id = control.operation_id().to_string();
    manager.mark_running(&operation_id).expect("running");

    let waits = Arc::new(Mutex::new(0usize));
    let waits_for_wait = Arc::clone(&waits);
    let manager_for_wait = manager.clone();
    let id_for_wait = operation_id.clone();
    // The wait takes the place of the 50 ms sleep and resumes on its first round. A gate that read no
    // phase would never call it, which is the falsification this test needs.
    let inner = PhaseGate {
        control: &control,
        wait: Box::new(move || {
            *waits_for_wait.lock().expect("wait counter") += 1;
            manager_for_wait.resume(&id_for_wait).expect("the operation was paused");
        }),
    };
    let mut gate = PauseAtBoundary {
        manager: &manager,
        operation_id: &operation_id,
        at: 2,
        seen: 0,
        inner,
    };

    let outcome = walk(&files, &mut gate, &WalkRequest::new([root.path()]));

    assert_eq!(*waits.lock().expect("wait counter"), 1, "the paused operation made the walk wait exactly once");
    let paths: Vec<String> = walked_pairs(&outcome).into_iter().map(|(path, _)| path).collect();
    assert_eq!(paths, root.expected_paths(), "the pause parked the walk; it did not shorten it");
    assert_eq!(
        gate.seen, 3,
        "one boundary per directory listed: the root, artist, and artist/deep — files ask for none"
    );
    assert_eq!(
        manager.get(&operation_id).expect("kept").phase,
        OperationPhase::Running,
        "the walk finished with the operation still running, not left paused"
    );
}

#[test]
fn a_cancel_at_a_boundary_hands_the_guest_nothing() {
    let root = TempRoot::new("cancel");
    let files = capability(&root.root);
    let manager = OperationManager::new(OperationManagerOptions::default());
    let control = manager.start("samea", None, None);
    let operation_id = control.operation_id().to_string();
    manager.mark_running(&operation_id).expect("running");
    manager.cancel(&operation_id, "the user stopped it").expect("cancellable");

    let outcome = walk(&files, &mut PhaseGate::sleeping(&control), &WalkRequest::new([root.path()]));
    assert_eq!(outcome, WalkOutcome::Cancelled);

    // Control: the identical tree on an uncancelled operation lists fully, so the cancel is what stopped
    // the walk rather than the fixture being broken.
    let running = manager.start("samea", None, None);
    manager.mark_running(running.operation_id()).expect("running");
    let listed = walk(&files, &mut PhaseGate::sleeping(&running), &WalkRequest::new([root.path()]));
    let WalkOutcome::Listing(walked) = listed else { panic!("the control walk should list: {listed:?}") };
    assert_eq!(walked.entry_count, 6);
}

#[test]
fn a_root_outside_the_grant_fails_the_walk_instead_of_returning_an_empty_tree() {
    let root = TempRoot::new("grant");
    let outside = std::env::temp_dir();
    let files = capability(&root.root);

    let refused = walk(&files, &mut EnterAlways, &WalkRequest::new([outside.to_string_lossy().into_owned()]));
    assert!(
        matches!(refused, WalkOutcome::Failed(_)),
        "a path the operation was not granted must be a refusal, not zero entries: {refused:?}"
    );

    let listed = walk(&files, &mut EnterAlways, &WalkRequest::new([root.path()]));
    assert_eq!(
        walked_pairs(&listed).into_iter().map(|(path, _)| path).collect::<Vec<_>>(),
        root.expected_paths()
    );
}

#[test]
fn a_ceiling_refuses_rather_than_handing_over_half_a_tree() {
    let root = TempRoot::new("ceiling");
    let files = capability(&root.root);

    let squeezed = walk(&files, &mut EnterAlways, &WalkRequest { max_entries: 2, ..WalkRequest::new([root.path()]) });
    assert_eq!(
        squeezed,
        WalkOutcome::Refused(Ceiling { which: "entries", limit: 2, seen: 2 }),
        "the walk must stop on the limit, not truncate the document"
    );

    let bytes_limited = walk(
        &files,
        &mut EnterAlways,
        &WalkRequest { max_listing_bytes: 24, ..WalkRequest::new([root.path()]) },
    );
    let WalkOutcome::Refused(Ceiling { which, .. }) = bytes_limited else {
        panic!("a 24-byte ceiling cannot hold this tree: {bytes_limited:?}")
    };
    assert_eq!(which, "listing_bytes");

    let roomy = walk(
        &files,
        &mut EnterAlways,
        &WalkRequest { max_entries: DEFAULT_MAX_ENTRIES, ..WalkRequest::new([root.path()]) },
    );
    let WalkOutcome::Listing(walked) = roomy else { panic!("the control walk should list: {roomy:?}") };
    assert_eq!(walked.entry_count, 6);
}

#[test]
fn the_reporting_gate_emits_one_progress_event_with_the_callers_wording() {
    let root = TempRoot::new("events");
    let files = capability(&root.root);
    let manager = OperationManager::new(OperationManagerOptions::default());
    let control = manager.start("samea", None, None);
    let operation_id = control.operation_id().to_string();
    manager.mark_running(&operation_id).expect("running");

    {
        let mut gate = ReportingGate::new(&control, &manager, &operation_id, "scanning");
        let outcome = walk(&files, &mut gate, &WalkRequest::new([root.path()]));
        assert_eq!(walked_pairs(&outcome).len(), 6, "reporting must not change what the walk emits");
    }

    let page = manager.events(&operation_id, None, None).expect("the operation is kept");
    let events = page.events;
    assert_eq!(events.len(), 1, "one progress event for a walk of three directories, the way the guest did it");
    assert_eq!(events[0].event.message, "scanning", "the node keeps its own wording");
    let WalkOutcome::Listing(walked) = walk(&files, &mut EnterAlways, &WalkRequest::new([root.path()])) else {
        unreachable!()
    };
    assert_eq!(walked.entry_count, 6);
}
