use std::path::PathBuf;

use napi::bindgen_prelude::{AsyncTask, Error, Result, Task};
use napi::{Env, Status};
use napi_derive::napi;
use xiranite_czkawka_core as core;

#[napi(object)]
pub struct CzkawkaInfo {
    pub api_version: u32,
    pub source_version: String,
}

#[napi]
pub fn get_czkawka_info() -> CzkawkaInfo {
    let info = core::czkawka_info();
    CzkawkaInfo {
        api_version: info.api_version,
        source_version: info.source_version.into(),
    }
}

#[napi(object)]
pub struct DuplicateScanOptions {
    pub included_directories: Vec<String>,
    pub excluded_directories: Option<Vec<String>>,
    pub excluded_items: Option<Vec<String>>,
    pub allowed_extensions: Option<String>,
    pub excluded_extensions: Option<String>,
    pub minimum_file_size: Option<i64>,
    pub maximum_file_size: Option<i64>,
    pub recursive: Option<bool>,
    pub use_cache: Option<bool>,
    pub ignore_hard_links: Option<bool>,
    pub use_prehash: Option<bool>,
    pub case_sensitive_names: Option<bool>,
    pub check_method: Option<String>,
    pub hash_type: Option<String>,
}

#[napi(object)]
pub struct DuplicateFile {
    pub path: String,
    pub modified_date: i64,
    pub size: i64,
    pub hash: String,
}

#[napi(object)]
pub struct DuplicateGroup {
    pub files: Vec<DuplicateFile>,
}

#[napi(object)]
pub struct DuplicateScanResult {
    pub groups: Vec<DuplicateGroup>,
    pub messages: String,
    pub stopped: bool,
}

pub struct DuplicateScanTask(core::DuplicateScanOptions);

#[napi]
pub fn scan_duplicate_files(options: DuplicateScanOptions) -> Result<AsyncTask<DuplicateScanTask>> {
    let included = options
        .included_directories
        .into_iter()
        .map(PathBuf::from)
        .collect();
    let mut core_options = core::DuplicateScanOptions::new(included);
    core_options.excluded_directories = options
        .excluded_directories
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect();
    core_options.excluded_items = options.excluded_items.unwrap_or_default();
    core_options.allowed_extensions = options.allowed_extensions.unwrap_or_default();
    core_options.excluded_extensions = options.excluded_extensions.unwrap_or_default();
    core_options.minimum_file_size =
        non_negative_u64(options.minimum_file_size.unwrap_or(1), "minimumFileSize")?;
    core_options.maximum_file_size = non_negative_u64(
        options.maximum_file_size.unwrap_or(i64::MAX),
        "maximumFileSize",
    )?;
    core_options.recursive = options.recursive.unwrap_or(true);
    core_options.use_cache = options.use_cache.unwrap_or(false);
    core_options.ignore_hard_links = options.ignore_hard_links.unwrap_or(true);
    core_options.use_prehash = options.use_prehash.unwrap_or(true);
    core_options.case_sensitive_names = options.case_sensitive_names.unwrap_or(false);
    core_options.check_method = match options.check_method.as_deref().unwrap_or("hash") {
        "name" => core::DuplicateCheckMethod::Name,
        "size" => core::DuplicateCheckMethod::Size,
        "size-and-name" | "sizeAndName" => core::DuplicateCheckMethod::SizeAndName,
        "hash" => core::DuplicateCheckMethod::Hash,
        value => {
            return Err(Error::new(
                Status::InvalidArg,
                format!("unsupported check method: {value}"),
            ));
        }
    };
    core_options.hash_type = match options.hash_type.as_deref().unwrap_or("blake3") {
        "crc32" => core::DuplicateHashType::Crc32,
        "xxh3" => core::DuplicateHashType::Xxh3,
        "blake3" => core::DuplicateHashType::Blake3,
        value => {
            return Err(Error::new(
                Status::InvalidArg,
                format!("unsupported hash type: {value}"),
            ));
        }
    };
    Ok(AsyncTask::new(DuplicateScanTask(core_options)))
}

impl Task for DuplicateScanTask {
    type Output = core::DuplicateScanResult;
    type JsValue = DuplicateScanResult;

    fn compute(&mut self) -> Result<Self::Output> {
        core::scan_duplicate_files(self.0.clone())
            .map_err(|error| Error::from_reason(error.to_string()))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(DuplicateScanResult {
            groups: output
                .groups
                .into_iter()
                .map(|group| DuplicateGroup {
                    files: group
                        .files
                        .into_iter()
                        .map(|file| DuplicateFile {
                            path: file.path.to_string_lossy().into_owned(),
                            modified_date: saturating_i64(file.modified_date),
                            size: saturating_i64(file.size),
                            hash: file.hash,
                        })
                        .collect(),
                })
                .collect(),
            messages: output.messages,
            stopped: output.stopped,
        })
    }
}

fn non_negative_u64(value: i64, name: &str) -> Result<u64> {
    u64::try_from(value)
        .map_err(|_| Error::new(Status::InvalidArg, format!("{name} cannot be negative")))
}

fn saturating_i64(value: u64) -> i64 {
    value.min(i64::MAX as u64) as i64
}
