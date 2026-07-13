use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Once;
use std::sync::atomic::AtomicBool;

use czkawka_core::common::config_cache_path::set_config_cache_path;
use czkawka_core::common::model::{CheckingMethod, HashType};
use czkawka_core::common::tool_data::CommonData;
use czkawka_core::common::traits::Search;
use czkawka_core::tools::duplicate::{DuplicateEntry, DuplicateFinder, DuplicateFinderParameters};
use thiserror::Error;

pub const API_VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum CzkawkaError {
    #[error("invalid option: {0}")]
    InvalidOption(String),
}

#[derive(Debug, Clone)]
pub struct CzkawkaInfo {
    pub api_version: u32,
    pub source_version: &'static str,
}

pub fn czkawka_info() -> CzkawkaInfo {
    CzkawkaInfo {
        api_version: API_VERSION,
        source_version: czkawka_core::CZKAWKA_VERSION,
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub enum DuplicateCheckMethod {
    Name,
    Size,
    SizeAndName,
    #[default]
    Hash,
}

#[derive(Debug, Clone, Copy, Default)]
pub enum DuplicateHashType {
    Crc32,
    Xxh3,
    #[default]
    Blake3,
}

#[derive(Debug, Clone)]
pub struct DuplicateScanOptions {
    pub included_directories: Vec<PathBuf>,
    pub excluded_directories: Vec<PathBuf>,
    pub excluded_items: Vec<String>,
    pub allowed_extensions: String,
    pub excluded_extensions: String,
    pub minimum_file_size: u64,
    pub maximum_file_size: u64,
    pub recursive: bool,
    pub use_cache: bool,
    pub ignore_hard_links: bool,
    pub use_prehash: bool,
    pub case_sensitive_names: bool,
    pub check_method: DuplicateCheckMethod,
    pub hash_type: DuplicateHashType,
}

impl DuplicateScanOptions {
    pub fn new(included_directories: Vec<PathBuf>) -> Self {
        Self {
            included_directories,
            excluded_directories: Vec::new(),
            excluded_items: Vec::new(),
            allowed_extensions: String::new(),
            excluded_extensions: String::new(),
            minimum_file_size: 1,
            maximum_file_size: u64::MAX,
            recursive: true,
            use_cache: false,
            ignore_hard_links: true,
            use_prehash: true,
            case_sensitive_names: false,
            check_method: DuplicateCheckMethod::Hash,
            hash_type: DuplicateHashType::Blake3,
        }
    }
}

#[derive(Debug, Clone)]
pub struct DuplicateFile {
    pub path: PathBuf,
    pub modified_date: u64,
    pub size: u64,
    pub hash: String,
}

#[derive(Debug, Clone)]
pub struct DuplicateGroup {
    pub files: Vec<DuplicateFile>,
}

#[derive(Debug, Clone)]
pub struct DuplicateScanResult {
    pub groups: Vec<DuplicateGroup>,
    pub messages: String,
    pub stopped: bool,
}

pub fn scan_duplicate_files(
    options: DuplicateScanOptions,
) -> Result<DuplicateScanResult, CzkawkaError> {
    if options.included_directories.is_empty() {
        return Err(CzkawkaError::InvalidOption(
            "included_directories cannot be empty".into(),
        ));
    }
    if options.minimum_file_size > options.maximum_file_size {
        return Err(CzkawkaError::InvalidOption(
            "minimum_file_size cannot exceed maximum_file_size".into(),
        ));
    }
    static INITIALIZE_CACHE_PATH: Once = Once::new();
    INITIALIZE_CACHE_PATH.call_once(|| {
        let _ = set_config_cache_path("xiranite", "xiranite");
    });

    let check_method = match options.check_method {
        DuplicateCheckMethod::Name => CheckingMethod::Name,
        DuplicateCheckMethod::Size => CheckingMethod::Size,
        DuplicateCheckMethod::SizeAndName => CheckingMethod::SizeName,
        DuplicateCheckMethod::Hash => CheckingMethod::Hash,
    };
    let hash_type = match options.hash_type {
        DuplicateHashType::Crc32 => HashType::Crc32,
        DuplicateHashType::Xxh3 => HashType::Xxh3,
        DuplicateHashType::Blake3 => HashType::Blake3,
    };
    let mut finder = DuplicateFinder::new(DuplicateFinderParameters::new(
        check_method,
        hash_type,
        options.ignore_hard_links,
        options.use_prehash,
        256 * 1024,
        4 * 1024,
        options.case_sensitive_names,
    ));
    finder.set_included_directory(options.included_directories);
    finder.set_excluded_directory(options.excluded_directories);
    finder.set_excluded_items(options.excluded_items);
    finder.set_allowed_extensions(options.allowed_extensions);
    finder.set_excluded_extensions(options.excluded_extensions);
    finder.set_minimal_file_size(options.minimum_file_size);
    finder.set_maximal_file_size(options.maximum_file_size);
    finder.set_recursive_search(options.recursive);
    finder.set_use_cache(options.use_cache);

    let stop = Arc::new(AtomicBool::new(false));
    finder.search(&stop, None);
    let raw_groups: Vec<Vec<DuplicateEntry>> = match check_method {
        CheckingMethod::Hash => finder
            .get_files_sorted_by_hash()
            .values()
            .flatten()
            .cloned()
            .collect(),
        CheckingMethod::Name => finder
            .get_files_sorted_by_names()
            .values()
            .cloned()
            .collect(),
        CheckingMethod::Size => finder
            .get_files_sorted_by_size()
            .values()
            .cloned()
            .collect(),
        CheckingMethod::SizeName => finder
            .get_files_sorted_by_size_name()
            .values()
            .cloned()
            .collect(),
        _ => unreachable!(),
    };
    let groups = raw_groups
        .into_iter()
        .map(|mut entries| {
            entries.sort_unstable_by(|a, b| a.path.cmp(&b.path));
            DuplicateGroup {
                files: entries
                    .into_iter()
                    .map(|entry| DuplicateFile {
                        path: entry.path,
                        modified_date: entry.modified_date,
                        size: entry.size,
                        hash: entry.hash,
                    })
                    .collect(),
            }
        })
        .collect();
    Ok(DuplicateScanResult {
        groups,
        messages: finder.get_text_messages().create_messages_text(),
        stopped: finder.get_stopped_search(),
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

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
}
