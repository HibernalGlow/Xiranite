//! The handle-based byte stream behind `xiranite.fs.open`/`.read`/`.close` (ADR-0070).
//!
//! The headline case is the one the document ceiling cannot serve: a file bigger than
//! `MAX_TEXT_BYTES` reassembled from chunks. Each guard here gets the case that fails if the guard is
//! removed, so a green run means the refusal fired and not that nothing asked.

use std::path::Path;

use xiranite_core::file_stream::{FileReadStream, MAX_CHUNK_BYTES};
use xiranite_core::filesystem::{FileCapability, FsCapabilityError, MAX_TEXT_BYTES};
use xiranite_plugin_api::{FileAccessMode, FileHandleToken};

/// A byte pattern that is not all-equal, so a truncated or reordered chunk is visible.
fn pattern_bytes(len: usize) -> Vec<u8> {
    (0..len).map(|index| u8::try_from(index % 251).unwrap_or_default()).collect()
}

fn stream(grant: &Path) -> FileReadStream {
    FileReadStream::new(FileCapability::new([grant]))
}

fn open_read(service: &FileReadStream, path: &Path) -> (FileHandleToken, u64) {
    service
        .open(&path.to_string_lossy(), FileAccessMode::Read)
        .expect("opening a granted file must succeed")
}

/// Reads the whole file through the handle in `chunk`-sized calls, the way a plugin must.
fn read_all(service: &FileReadStream, handle: FileHandleToken, size: u64, chunk: u32) -> Vec<u8> {
    let mut gathered = Vec::new();
    let mut offset = 0u64;
    loop {
        let piece = service.read_chunk(handle, offset, chunk).expect("chunk read");
        if piece.is_empty() {
            break;
        }
        offset += piece.len() as u64;
        gathered.extend_from_slice(&piece);
        assert!(offset <= size, "the host answered past the end of the file");
    }
    gathered
}

#[test]
fn a_file_past_the_text_ceiling_reassembles_from_chunks() {
    let root = tempfile::tempdir().expect("tempdir");
    let size = MAX_TEXT_BYTES as usize + 1;
    let contents = pattern_bytes(size);
    let file = root.path().join("tail-zip.bin");
    std::fs::write(&file, &contents).expect("fixture write");

    // Positive control: the same file is exactly what the document read refuses, so this test is
    // evidence about the ceiling being crossed and not about the ceiling having quietly moved.
    let documents = FileCapability::new([root.path()]);
    let refusal = documents
        .read_text(&file.to_string_lossy())
        .expect_err("the text ceiling must still refuse this file");
    assert_eq!(refusal.code(), "text_too_large");

    let service = stream(root.path());
    let (handle, reported) = open_read(&service, &file);
    assert_eq!(reported, size as u64, "open reports the size a plugin plans its chunks with");
    assert_eq!(read_all(&service, handle, reported, MAX_CHUNK_BYTES), contents);
}

#[test]
fn a_short_tail_terminates_the_read_loop_at_the_real_size() {
    let root = tempfile::tempdir().expect("tempdir");
    let contents = pattern_bytes(MAX_CHUNK_BYTES as usize + 7);
    let file = root.path().join("odd-length.bin");
    std::fs::write(&file, &contents).expect("fixture write");

    let service = stream(root.path());
    let (handle, reported) = open_read(&service, &file);
    let gathered = read_all(&service, handle, reported, 4096);
    assert_eq!(gathered.len(), contents.len(), "many small chunks must not lose or repeat bytes");
    assert_eq!(gathered, contents);
}

#[test]
fn an_offset_at_or_past_the_end_reads_as_end_of_stream() {
    let root = tempfile::tempdir().expect("tempdir");
    let file = root.path().join("small.bin");
    std::fs::write(&file, pattern_bytes(10)).expect("fixture write");

    let service = stream(root.path());
    let (handle, size) = open_read(&service, &file);
    for offset in [size, size + 1, u64::from(u32::MAX) * 4096] {
        let piece = service.read_chunk(handle, offset, 4096).expect("EOF is an answer, not a refusal");
        assert!(piece.is_empty(), "offset {offset} is past the end and must read empty");
    }
}

#[test]
fn the_chunk_ceiling_refuses_an_oversized_request() {
    let root = tempfile::tempdir().expect("tempdir");
    let file = root.path().join("big.bin");
    std::fs::write(&file, pattern_bytes(MAX_CHUNK_BYTES as usize * 2)).expect("fixture write");

    let service = stream(root.path());
    let (handle, _) = open_read(&service, &file);
    let error = service
        .read_chunk(handle, 0, MAX_CHUNK_BYTES + 1)
        .expect_err("one call must not be able to ask for the rest of the file");
    assert_eq!(error.code(), "chunk_too_large");
}

#[test]
fn a_zero_length_request_is_refused_rather_than_confused_with_eof() {
    let root = tempfile::tempdir().expect("tempdir");
    let file = root.path().join("any.bin");
    std::fs::write(&file, pattern_bytes(4)).expect("fixture write");

    let service = stream(root.path());
    let (handle, _) = open_read(&service, &file);
    let error = service
        .read_chunk(handle, 0, 0)
        .expect_err("an empty request is a plugin bug, not an empty answer");
    assert_eq!(error.code(), "empty_chunk");
}

#[test]
fn a_path_outside_the_grant_never_becomes_a_handle() {
    let granted = tempfile::tempdir().expect("tempdir");
    let outside = tempfile::tempdir().expect("tempdir");
    let secret = outside.path().join("not-yours.bin");
    std::fs::write(&secret, pattern_bytes(64)).expect("fixture write");

    let service = stream(granted.path());
    let error = service
        .open(&secret.to_string_lossy(), FileAccessMode::Read)
        .expect_err("a sibling tree is not granted");
    assert_eq!(error.code(), "permission_denied");

    // The escape shape the grant list exists for: a `..` that lands outside after canonicalizing.
    let escape = format!("{}/../escape.bin", granted.path().display());
    let error = service
        .open(&escape, FileAccessMode::Read)
        .expect_err("a relative walk out of the grant must be refused");
    assert_eq!(error.code(), "permission_denied");
}

#[test]
fn opening_a_directory_is_refused() {
    let root = tempfile::tempdir().expect("tempdir");
    let service = stream(root.path());
    let error = service
        .open(&root.path().to_string_lossy(), FileAccessMode::Read)
        .expect_err("a directory has no byte stream to hand out");
    assert_eq!(error.code(), "is_directory");
}

#[test]
fn write_mode_refuses_as_not_implemented_instead_of_opening_an_unjournalable_handle() {
    let root = tempfile::tempdir().expect("tempdir");
    let file = root.path().join("target.bin");
    std::fs::write(&file, pattern_bytes(8)).expect("fixture write");

    let service = stream(root.path());
    let error = service
        .open(&file.to_string_lossy(), FileAccessMode::Write)
        .expect_err("the journal that makes a streamed write undoable does not exist yet");
    assert_eq!(error.code(), "not_implemented");
}

#[test]
fn close_releases_the_handle_and_a_second_close_is_not_found() {
    let root = tempfile::tempdir().expect("tempdir");
    let file = root.path().join("once.bin");
    std::fs::write(&file, pattern_bytes(16)).expect("fixture write");

    let service = stream(root.path());
    let (handle, size) = open_read(&service, &file);
    assert_eq!(service.opened_path(handle).as_deref(), Some(&*file.to_string_lossy()));
    service.close(handle).expect("first close");
    let error = service.close(handle).expect_err("a closed handle is gone");
    assert_eq!(error, FsCapabilityError::NotFound);
    let error = service
        .read_chunk(handle, 0, 8)
        .expect_err("reading a closed handle must not resurrect it");
    assert_eq!(error.code(), "not_found");
    assert_eq!(size, 16);
}

#[test]
fn a_handle_is_only_live_in_the_operation_that_minted_it() {
    let root = tempfile::tempdir().expect("tempdir");
    let file = root.path().join("per-operation.bin");
    std::fs::write(&file, pattern_bytes(32)).expect("fixture write");

    let first = stream(root.path());
    let (handle, _) = open_read(&first, &file);
    // A second service stands for a second operation over the same grant: the token must not carry
    // over, which is what keeps one plugin instance serving `Operation 1..N` honest (ADR-0068).
    let second = stream(root.path());
    let error = second
        .read_chunk(handle, 0, 8)
        .expect_err("another operation's handle is not a live id here");
    assert_eq!(error.code(), "not_found");
}

#[test]
fn dropping_the_service_reclaims_open_handles() {
    let root = tempfile::tempdir().expect("tempdir");
    let file = root.path().join("dropped.bin");
    std::fs::write(&file, pattern_bytes(64)).expect("fixture write");

    let handle = {
        let service = stream(root.path());
        let (handle, _) = open_read(&service, &file);
        assert_eq!(service.read_chunk(handle, 0, 8).expect("read").len(), 8);
        handle
    };
    let rebuilt = stream(root.path());
    let error = rebuilt
        .read_chunk(handle, 0, 8)
        .expect_err("the run that opened it is over, so the id is dead");
    assert_eq!(error.code(), "not_found");
}
