//! The rules `packages/nodes/findz/src/watcher-service.ts` already states, tested against a
//! fabricated clock and, once, against a real directory. The clock tests are the point: they check
//! *when* a change is believed, which no amount of sleeping in a test could pin down.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use notify::event::{AccessKind, CreateKind, DataChange, MetadataKind};

use super::*;

fn change(path: &str, kind: ChangeKind) -> PendingChange {
    PendingChange {
        path: PathBuf::from(path),
        kind,
    }
}

fn drained(state: &mut WatchState) -> Vec<PendingChange> {
    std::mem::take(&mut state.ready)
}

#[test]
fn the_latest_event_for_a_path_wins_and_voids_its_earlier_reading() {
    let mut state = WatchState::new();
    let now = Instant::now();
    state.queue(
        vec![
            change("/lib/a.cbz", ChangeKind::Create),
            change("/lib/a.cbz", ChangeKind::Update),
        ],
        now,
    );
    assert_eq!(state.changes.len(), 1, "one path must hold one change");
    assert_eq!(
        state.changes[Path::new("/lib/a.cbz")].kind,
        ChangeKind::Update,
        "the last event for a path is the one that stands"
    );
}

#[test]
fn a_change_is_not_believed_until_the_quiet_window_has_passed() {
    let mut state = WatchState::new();
    let now = Instant::now();
    state.queue(vec![change("/lib/a.cbz", ChangeKind::Create)], now);
    state.flush_if_quiet(now + Duration::from_millis(100));
    assert!(drained(&mut state).is_empty(), "100 ms is not quiet yet");
    state.flush_if_quiet(now + QUIET_WINDOW);
    assert!(
        !drained(&mut state).is_empty(),
        "POSITIVE CONTROL BROKEN: nothing is ever believed, so the feed would deliver nothing"
    );
}

#[test]
fn every_new_event_restarts_the_quiet_window() {
    let mut state = WatchState::new();
    let t0 = Instant::now();
    state.queue(vec![change("/lib/a.cbz", ChangeKind::Create)], t0);
    state.queue(vec![change("/lib/a.cbz", ChangeKind::Update)], t0 + Duration::from_millis(200));
    state.flush_if_quiet(t0 + Duration::from_millis(300));
    assert!(
        drained(&mut state).is_empty(),
        "an event at 200 ms must push the deadline to 450 ms"
    );
    state.flush_if_quiet(t0 + Duration::from_millis(460));
    assert_eq!(drained(&mut state).len(), 1);
}

#[test]
fn a_path_that_is_still_growing_is_waited_on() {
    let directory = std::env::temp_dir().join(format!("xiranite-watch-growing-{}", std::process::id()));
    let _ = fs::remove_dir_all(&directory);
    fs::create_dir_all(&directory).expect("the temp directory exists");
    let file = directory.join("growing.cbz");
    fs::write(&file, vec![0_u8; 16]).expect("the first write lands");

    let mut state = WatchState::new();
    let now = Instant::now();
    state.queue(vec![PendingChange { path: file.clone(), kind: ChangeKind::Create }], now);
    state.flush_if_quiet(now + QUIET_WINDOW);
    assert!(
        drained(&mut state).is_empty(),
        "a first sighting only records the size; it is not proof the write finished"
    );

    fs::write(&file, vec![0_u8; 64]).expect("the second write lands");
    state.flush_if_quiet(now + QUIET_WINDOW * 2);
    assert!(drained(&mut state).is_empty(), "a moved size must not be believed");

    state.flush_if_quiet(now + QUIET_WINDOW * 3);
    let delivered = drained(&mut state);
    assert_eq!(delivered.len(), 1, "a stable size must be delivered, not waited on forever");
    assert_eq!(delivered[0].kind, ChangeKind::Create, "the type is the event's, not the observation's");
    let _ = fs::remove_dir_all(&directory);
}

#[test]
fn a_delete_is_believed_without_waiting_for_a_stat() {
    let mut state = WatchState::new();
    let now = Instant::now();
    state.queue(vec![change("/definitely/not/here.cbz", ChangeKind::Delete)], now);
    state.flush_if_quiet(now + QUIET_WINDOW);
    let delivered = drained(&mut state);
    assert_eq!(delivered.len(), 1, "a delete of a path that cannot be statted still matters");
    assert_eq!(delivered[0].kind, ChangeKind::Delete);
}

#[test]
fn a_path_that_vanished_between_event_and_read_reports_a_delete() {
    let directory = std::env::temp_dir().join(format!("xiranite-watch-vanish-{}", std::process::id()));
    let _ = fs::remove_dir_all(&directory);
    fs::create_dir_all(&directory).unwrap();
    let file = directory.join("gone.cbz");
    fs::write(&file, b"x").unwrap();

    let mut state = WatchState::new();
    let now = Instant::now();
    state.queue(vec![PendingChange { path: file.clone(), kind: ChangeKind::Create }], now);
    state.flush_if_quiet(now + QUIET_WINDOW);
    drained(&mut state);
    fs::remove_file(&file).expect("the file goes away before the next pass");
    state.flush_if_quiet(now + QUIET_WINDOW * 2);
    let delivered = drained(&mut state);
    assert_eq!(delivered.len(), 1, "the row must not be pinned because the file disappeared");
    assert_eq!(
        delivered[0].kind,
        ChangeKind::Delete,
        "a create whose file is gone is a delete as far as the index is concerned"
    );
    let _ = fs::remove_dir_all(&directory);
}

#[test]
fn a_failing_filesystem_earns_one_reconcile_until_something_delivers() {
    let mut state = WatchState::new();
    assert!(state.degrade(), "the first failure must queue a reconcile");
    assert!(!state.degrade(), "a second failure must not queue a second one");
    state.delivered();
    assert!(state.degrade(), "a delivered batch releases the allowance again");
}

#[test]
fn closing_stops_believing_anything() {
    let mut state = WatchState::new();
    let now = Instant::now();
    state.queue(vec![change("/lib/a.cbz", ChangeKind::Create)], now);
    state.close();
    state.queue(vec![change("/lib/b.cbz", ChangeKind::Create)], now);
    state.flush_if_quiet(now + QUIET_WINDOW * 2);
    assert!(drained(&mut state).is_empty(), "a closed watch delivers nothing");
    assert!(!state.degrade(), "a closed watch does not queue reconciles either");
}

#[test]
fn metadata_only_and_access_events_move_nothing() {
    let paths = vec![PathBuf::from("/lib/a.cbz")];
    assert!(translate(&EventKind::Access(AccessKind::Read), &paths).is_empty());
    assert!(
        translate(&EventKind::Modify(ModifyKind::Metadata(MetadataKind::Permissions)), &paths).is_empty(),
        "a chmod is not an archive changing"
    );
    // The positive controls: what *is* content has to map, on the two paths the backends use.
    let created = translate(&EventKind::Create(CreateKind::File), &paths);
    assert_eq!(created.len(), 1, "POSITIVE CONTROL BROKEN: nothing ever maps");
    assert_eq!(created[0].kind, ChangeKind::Create);
    assert_eq!(
        translate(&EventKind::Modify(ModifyKind::Data(DataChange::Content)), &paths)[0].kind,
        ChangeKind::Update,
        "a content write must reach the index"
    );
    assert_eq!(
        translate(&EventKind::Modify(ModifyKind::Any), &paths)[0].kind,
        ChangeKind::Update,
        "a backend that does not classify (macOS' fsevent) must still be believed"
    );
}

#[test]
fn a_real_file_appearing_in_the_library_reaches_the_buffer() {
    // The subscription is what the node used to do with `@parcel/watcher`. If notify's backend for
    // this platform never delivered, the whole decision-5 feed would be a fiction, so this test is
    // allowed to be slow but not to be skipped.
    let raw = std::env::temp_dir().join(format!("xiranite-watch-live-{}", std::process::id()));
    let _ = fs::remove_dir_all(&raw);
    fs::create_dir_all(&raw).expect("the temp library exists");
    // notify reports canonical paths, and macOS' temp dir is a symlink (`/var` → `/private/var`), so
    // comparing against the unresolved one would fail even when delivery works. Same trap the holder
    // resolves for `library.open`.
    let directory = raw.canonicalize().expect("the temp library canonicalizes");
    let watch = LibraryWatch::start("library-live", &directory).expect("notify subscribes to the directory");

    let file = directory.join("arrived.cbz");
    // Written once, then left alone. The previous version rewrote it every 150 ms and then complained
    // that nothing arrived — but a file whose mtime keeps moving is precisely what the stability rule
    // refuses to believe, so that test was asserting the opposite of what it meant.
    fs::write(&file, b"hello").expect("the file lands once");
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut seen = Vec::new();
    while Instant::now() < deadline {
        if let Some((mut batch, _)) = watch.take_signal() {
            seen.append(&mut batch);
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(
        seen.iter().any(|change| change.path == file),
        "a file written into the watched directory never reached the buffer within 10 s; \
         what did arrive: {:?} (watched {})",
        seen,
        directory.display()
    );
    drop(watch);
    let _ = fs::remove_dir_all(&directory);
}

#[test]
fn dropping_the_watch_joins_its_thread() {
    let directory = std::env::temp_dir().join(format!("xiranite-watch-drop-{}", std::process::id()));
    let _ = fs::remove_dir_all(&directory);
    fs::create_dir_all(&directory).unwrap();
    let watch = LibraryWatch::start("library-drop", &directory).expect("the watch starts");
    assert!(watch.thread.is_some(), "the watch runs a thread");
    drop(watch);
    // `Drop` signals and joins, so the thread is gone by the time this returns: an orphan would feed
    // a dead engine forever, which is the leak this whole design exists to avoid.
    let _ = fs::remove_dir_all(&directory);
}

#[test]
fn a_backend_error_waits_to_be_reported_once_and_not_again() {
    // notify's error carries no path, so there is nothing to queue — but "events stopped" has to
    // reach the library's health row, or a dead subscription is indistinguishable from a quiet
    // library. `take_signal` is the hand-off; this pins that it fires exactly once.
    let mut state = WatchState::new();
    assert!(state.take_signal().is_none(), "a healthy watch with nothing pending says nothing");
    state.note_stream_error();
    let (changes, error) = state.take_signal().expect("the parked error is handed over");
    assert!(changes.is_empty() && error);
    assert!(state.take_signal().is_none(), "the same error must not be reported twice");
    state.delivered();
    state.note_stream_error();
    assert!(
        state.take_signal().is_some_and(|(_, error)| error),
        "POSITIVE CONTROL BROKEN: after a delivery a new error must be reportable again"
    );
}
