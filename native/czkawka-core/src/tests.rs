use std::fs;

use tempfile::tempdir;

use crate::{DuplicateScanOptions, scan_duplicate_files};

#[test]
fn duplicate_scan_returns_identical_files() {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("one.bin"), b"same-content").unwrap();
    fs::write(dir.path().join("two.bin"), b"same-content").unwrap();
    fs::write(dir.path().join("different.bin"), b"different-content").unwrap();

    let options = DuplicateScanOptions::new(vec![dir.path().to_path_buf()]);
    let result = scan_duplicate_files(options).unwrap();
    assert_eq!(result.groups.len(), 1);
    assert_eq!(result.groups[0].files.len(), 2);
    assert!(!result.stopped);
}
