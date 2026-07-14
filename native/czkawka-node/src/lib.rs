use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use napi::bindgen_prelude::{AsyncTask, Error, Result, Task};
use napi::{Env, Status};
use napi_derive::napi;
use xiranite_czkawka_core as core;

#[derive(Clone)]
struct ScanSession { id: String, stop: Arc<AtomicBool>, progress: Arc<Mutex<Option<core::ScanProgress>>> }
fn scan_sessions() -> &'static Mutex<HashMap<String, ScanSession>> { static SESSIONS: OnceLock<Mutex<HashMap<String, ScanSession>>> = OnceLock::new(); SESSIONS.get_or_init(|| Mutex::new(HashMap::new())) }
impl ScanSession {
    fn create(id: Option<String>) -> Option<Self> { let id = id?.trim().to_owned(); if id.is_empty() { return None; } let session = Self { id: id.clone(), stop: Arc::new(AtomicBool::new(false)), progress: Arc::new(Mutex::new(None)) }; if let Some(previous) = scan_sessions().lock().expect("scan session registry poisoned").insert(id, session.clone()) { previous.stop.store(true, Ordering::Relaxed); } Some(session) }
    fn finish(&self) { let mut sessions = scan_sessions().lock().expect("scan session registry poisoned"); if sessions.get(&self.id).is_some_and(|current| Arc::ptr_eq(&current.stop, &self.stop)) { sessions.remove(&self.id); } }
}

#[napi(object)]
pub struct CzkawkaScanProgress { pub stage: String, pub stage_index: u32, pub stage_count: u32, pub entries_checked: i64, pub entries_total: i64, pub bytes_checked: i64, pub bytes_total: i64 }
#[napi]
pub fn cancel_czkawka_scan(scan_id: String) -> bool { let sessions = scan_sessions().lock().expect("scan session registry poisoned"); let Some(session) = sessions.get(&scan_id) else { return false; }; session.stop.store(true, Ordering::Relaxed); true }
#[napi]
pub fn get_czkawka_scan_progress(scan_id: String) -> Option<CzkawkaScanProgress> { let sessions = scan_sessions().lock().expect("scan session registry poisoned"); let session = sessions.get(&scan_id)?; let progress = session.progress.lock().expect("scan progress poisoned").clone()?; Some(CzkawkaScanProgress { stage: progress.stage, stage_index: progress.stage_index.into(), stage_count: progress.stage_count.into(), entries_checked: saturating_i64(progress.entries_checked as u64), entries_total: saturating_i64(progress.entries_total as u64), bytes_checked: saturating_i64(progress.bytes_checked), bytes_total: saturating_i64(progress.bytes_total) }) }
fn run_controlled<T>(session: &Option<ScanSession>, scan: impl FnOnce(&core::ScanControl) -> std::result::Result<T, core::CzkawkaError>) -> Result<T> { let Some(session) = session else { return scan(&core::ScanControl::detached()).map_err(|error| Error::from_reason(error.to_string())); }; let (control, progress_receiver) = core::ScanControl::channel(session.stop.clone()); let progress_state = session.progress.clone(); let monitor = std::thread::spawn(move || while let Ok(progress) = progress_receiver.recv() { *progress_state.lock().expect("scan progress poisoned") = Some(progress); }); let result = scan(&control).map_err(|error| Error::from_reason(error.to_string())); drop(control); let _ = monitor.join(); session.finish(); result }

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
    pub reference_directories: Option<Vec<String>>,
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
    pub scan_id: Option<String>,
    pub thread_count: Option<u32>,
}

#[napi(object)]
pub struct DuplicateFile {
    pub path: String,
    pub modified_date: i64,
    pub size: i64,
    pub hash: String,
    pub is_reference: bool,
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

pub struct DuplicateScanTask { options: core::DuplicateScanOptions, session: Option<ScanSession>, thread_count: usize }

#[napi]
pub fn scan_duplicate_files(options: DuplicateScanOptions) -> Result<AsyncTask<DuplicateScanTask>> {
    let included = options
        .included_directories
        .into_iter()
        .map(PathBuf::from)
        .collect();
    let mut core_options = core::DuplicateScanOptions::new(included);
    core_options.reference_directories = options
        .reference_directories
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect();
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
    let session = ScanSession::create(options.scan_id);
    Ok(AsyncTask::new(DuplicateScanTask { options: core_options, session, thread_count: options.thread_count.unwrap_or(0) as usize }))
}

impl Task for DuplicateScanTask {
    type Output = core::DuplicateScanResult;
    type JsValue = DuplicateScanResult;

    fn compute(&mut self) -> Result<Self::Output> {
        core::initialize_threads(self.thread_count);
        run_controlled(&self.session, |control| core::scan_duplicate_files_controlled(self.options.clone(), control))
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
                            is_reference: file.is_reference,
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

#[napi(object)]
pub struct BasicScanOptions {
    pub tool: String,
    pub included_directories: Vec<String>,
    pub reference_directories: Option<Vec<String>>,
    pub excluded_directories: Option<Vec<String>>,
    pub excluded_items: Option<Vec<String>>,
    pub allowed_extensions: Option<String>,
    pub excluded_extensions: Option<String>,
    pub recursive: Option<bool>,
    pub minimum_file_size: Option<i64>,
    pub maximum_file_size: Option<i64>,
    pub use_cache: Option<bool>,
    pub number_of_files: Option<u32>,
    pub biggest_first: Option<bool>,
    pub scan_id: Option<String>,
    pub thread_count: Option<u32>,
}

#[napi(object)]
pub struct BasicEntry {
    pub path: String,
    pub size: i64,
    pub modified_date: i64,
    pub secondary_path: Option<String>,
    pub detail: Option<String>,
}

#[napi(object)]
pub struct BasicScanResult {
    pub entries: Vec<BasicEntry>,
    pub messages: String,
    pub stopped: bool,
}

pub struct BasicScanTask { options: core::BasicScanOptions, session: Option<ScanSession>, thread_count: usize }

#[napi]
pub fn scan_basic_files(options: BasicScanOptions) -> Result<AsyncTask<BasicScanTask>> {
    let tool = match options.tool.as_str() {
        "big-files" | "bigFiles" => core::BasicTool::BigFiles,
        "empty-files" | "emptyFiles" => core::BasicTool::EmptyFiles,
        "empty-folders" | "emptyFolders" => core::BasicTool::EmptyFolders,
        "temporary-files" | "temporaryFiles" => core::BasicTool::TemporaryFiles,
        "invalid-symlinks" | "invalidSymlinks" => core::BasicTool::InvalidSymlinks,
        value => {
            return Err(Error::new(
                Status::InvalidArg,
                format!("unsupported basic tool: {value}"),
            ));
        }
    };
    let included = options
        .included_directories
        .into_iter()
        .map(PathBuf::from)
        .collect();
    let mut core_options = core::BasicScanOptions::new(tool, included);
    core_options.reference_directories = options
        .reference_directories
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect();
    core_options.excluded_directories = options
        .excluded_directories
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect();
    core_options.excluded_items = options.excluded_items.unwrap_or_default();
    core_options.allowed_extensions = options.allowed_extensions.unwrap_or_default();
    core_options.excluded_extensions = options.excluded_extensions.unwrap_or_default();
    core_options.recursive = options.recursive.unwrap_or(true);
    core_options.minimum_file_size = non_negative_u64(options.minimum_file_size.unwrap_or(1), "minimumFileSize")?;
    core_options.maximum_file_size = non_negative_u64(options.maximum_file_size.unwrap_or(i64::MAX), "maximumFileSize")?;
    core_options.use_cache = options.use_cache.unwrap_or(true);
    core_options.number_of_files = options.number_of_files.unwrap_or(50).max(1) as usize;
    core_options.biggest_first = options.biggest_first.unwrap_or(true);
    let session = ScanSession::create(options.scan_id);
    Ok(AsyncTask::new(BasicScanTask { options: core_options, session, thread_count: options.thread_count.unwrap_or(0) as usize }))
}

impl Task for BasicScanTask {
    type Output = core::BasicScanResult;
    type JsValue = BasicScanResult;

    fn compute(&mut self) -> Result<Self::Output> {
        core::initialize_threads(self.thread_count);
        run_controlled(&self.session, |control| core::scan_basic_files_controlled(self.options.clone(), control))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(BasicScanResult {
            entries: output
                .entries
                .into_iter()
                .map(|entry| BasicEntry {
                    path: entry.path.to_string_lossy().into_owned(),
                    size: saturating_i64(entry.size),
                    modified_date: saturating_i64(entry.modified_date),
                    secondary_path: entry
                        .secondary_path
                        .map(|path| path.to_string_lossy().into_owned()),
                    detail: entry.detail,
                })
                .collect(),
            messages: output.messages,
            stopped: output.stopped,
        })
    }
}

#[napi(object)]
pub struct MediaScanOptions {
    pub tool: String,
    pub included_directories: Vec<String>,
    pub reference_directories: Option<Vec<String>>,
    pub excluded_directories: Option<Vec<String>>,
    pub excluded_items: Option<Vec<String>>,
    pub allowed_extensions: Option<String>,
    pub excluded_extensions: Option<String>,
    pub recursive: Option<bool>,
    pub minimum_file_size: Option<i64>,
    pub maximum_file_size: Option<i64>,
    pub use_cache: Option<bool>,
    pub ignore_hard_links: Option<bool>,
    pub similarity: Option<u32>,
    pub image_hash_size: Option<u32>,
    pub image_hash_algorithm: Option<String>,
    pub image_resize_algorithm: Option<String>,
    pub image_ignore_same_size: Option<bool>,
    pub video_ignore_same_size: Option<bool>,
    pub video_skip_forward: Option<u32>,
    pub video_hash_duration: Option<u32>,
    pub video_crop_detect: Option<String>,
    pub music_check_type: Option<String>,
    pub music_approximate_comparison: Option<bool>,
    pub music_compare_title: Option<bool>,
    pub music_compare_artist: Option<bool>,
    pub music_compare_bitrate: Option<bool>,
    pub music_compare_genre: Option<bool>,
    pub music_compare_year: Option<bool>,
    pub music_compare_length: Option<bool>,
    pub music_maximum_difference: Option<f64>,
    pub music_minimum_fragment_duration: Option<f64>,
    pub music_compare_fingerprints_only_with_similar_titles: Option<bool>,
    pub broken_audio: Option<bool>,
    pub broken_pdf: Option<bool>,
    pub broken_archive: Option<bool>,
    pub broken_image: Option<bool>,
    pub scan_id: Option<String>,
    pub thread_count: Option<u32>,
}

#[napi(object)]
pub struct MediaEntry {
    pub path: String,
    pub size: i64,
    pub modified_date: i64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub similarity: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub year: Option<String>,
    pub length: Option<String>,
    pub genre: Option<String>,
    pub bitrate: Option<u32>,
    pub is_reference: bool,
    pub detail: Option<String>,
    pub proper_extension: Option<String>,
}

#[napi(object)]
pub struct MediaGroup {
    pub entries: Vec<MediaEntry>,
}

#[napi(object)]
pub struct MediaScanResult {
    pub groups: Vec<MediaGroup>,
    pub messages: String,
    pub stopped: bool,
}

pub struct MediaScanTask { options: core::MediaScanOptions, session: Option<ScanSession>, thread_count: usize }

#[napi]
pub fn scan_media_files(options: MediaScanOptions) -> Result<AsyncTask<MediaScanTask>> {
    let tool = match options.tool.as_str() {
        "similar-images" | "similarImages" => core::MediaTool::SimilarImages,
        "similar-videos" | "similarVideos" => core::MediaTool::SimilarVideos,
        "duplicate-music" | "duplicateMusic" => core::MediaTool::DuplicateMusic,
        "broken-files" | "brokenFiles" => core::MediaTool::BrokenFiles,
        "bad-extensions" | "badExtensions" => core::MediaTool::BadExtensions,
        value => {
            return Err(Error::new(
                Status::InvalidArg,
                format!("unsupported media tool: {value}"),
            ));
        }
    };
    let included = options
        .included_directories
        .into_iter()
        .map(PathBuf::from)
        .collect();
    let mut core_options = core::MediaScanOptions::new(tool, included);
    core_options.reference_directories = options
        .reference_directories
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect();
    core_options.excluded_directories = options
        .excluded_directories
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect();
    core_options.excluded_items = options.excluded_items.unwrap_or_default();
    core_options.allowed_extensions = options.allowed_extensions.unwrap_or_default();
    core_options.excluded_extensions = options.excluded_extensions.unwrap_or_default();
    core_options.recursive = options.recursive.unwrap_or(true);
    core_options.minimum_file_size = non_negative_u64(options.minimum_file_size.unwrap_or(1), "minimumFileSize")?;
    core_options.maximum_file_size = non_negative_u64(options.maximum_file_size.unwrap_or(i64::MAX), "maximumFileSize")?;
    core_options.use_cache = options.use_cache.unwrap_or(true);
    core_options.ignore_hard_links = options.ignore_hard_links.unwrap_or(true);
    core_options.similarity = options.similarity.unwrap_or(10);
    core_options.image_hash_size = options.image_hash_size.unwrap_or(16).clamp(1, u8::MAX as u32) as u8;
    core_options.image_hash_algorithm = match options.image_hash_algorithm.as_deref().unwrap_or("mean") {
        "mean" => core::ImageHashAlgorithm::Mean,
        "gradient" => core::ImageHashAlgorithm::Gradient,
        "blockhash" => core::ImageHashAlgorithm::Blockhash,
        "vert-gradient" | "vertGradient" => core::ImageHashAlgorithm::VertGradient,
        "double-gradient" | "doubleGradient" => core::ImageHashAlgorithm::DoubleGradient,
        "median" => core::ImageHashAlgorithm::Median,
        value => return Err(Error::new(Status::InvalidArg, format!("unsupported image hash algorithm: {value}"))),
    };
    core_options.image_resize_algorithm = match options.image_resize_algorithm.as_deref().unwrap_or("lanczos3") {
        "lanczos3" => core::ImageResizeAlgorithm::Lanczos3,
        "gaussian" => core::ImageResizeAlgorithm::Gaussian,
        "catmull-rom" | "catmullRom" => core::ImageResizeAlgorithm::CatmullRom,
        "triangle" => core::ImageResizeAlgorithm::Triangle,
        "nearest" => core::ImageResizeAlgorithm::Nearest,
        value => return Err(Error::new(Status::InvalidArg, format!("unsupported image resize algorithm: {value}"))),
    };
    core_options.image_ignore_same_size = options.image_ignore_same_size.unwrap_or(false);
    core_options.video_ignore_same_size = options.video_ignore_same_size.unwrap_or(false);
    core_options.video_skip_forward = options.video_skip_forward.unwrap_or(15);
    core_options.video_hash_duration = options.video_hash_duration.unwrap_or(10).max(2);
    core_options.video_crop_detect = match options.video_crop_detect.as_deref().unwrap_or("letterbox") {
        "letterbox" => core::VideoCropDetect::Letterbox,
        "motion" => core::VideoCropDetect::Motion,
        "none" => core::VideoCropDetect::None,
        value => return Err(Error::new(Status::InvalidArg, format!("unsupported video crop detection: {value}"))),
    };
    core_options.music_check_type = match options.music_check_type.as_deref().unwrap_or("tags") {
        "tags" => core::MusicCheckType::Tags,
        "fingerprint" => core::MusicCheckType::Fingerprint,
        value => return Err(Error::new(Status::InvalidArg, format!("unsupported music check type: {value}"))),
    };
    core_options.music_approximate_comparison = options.music_approximate_comparison.unwrap_or(true);
    core_options.music_compare_title = options.music_compare_title.unwrap_or(true);
    core_options.music_compare_artist = options.music_compare_artist.unwrap_or(true);
    core_options.music_compare_bitrate = options.music_compare_bitrate.unwrap_or(false);
    core_options.music_compare_genre = options.music_compare_genre.unwrap_or(false);
    core_options.music_compare_year = options.music_compare_year.unwrap_or(false);
    core_options.music_compare_length = options.music_compare_length.unwrap_or(false);
    core_options.music_maximum_difference = options.music_maximum_difference.unwrap_or(10.0).clamp(0.0, 10.0);
    core_options.music_minimum_fragment_duration = options.music_minimum_fragment_duration.unwrap_or(15.0).max(0.0) as f32;
    core_options.music_compare_fingerprints_only_with_similar_titles = options.music_compare_fingerprints_only_with_similar_titles.unwrap_or(true);
    core_options.broken_audio = options.broken_audio.unwrap_or(true);
    core_options.broken_pdf = options.broken_pdf.unwrap_or(true);
    core_options.broken_archive = options.broken_archive.unwrap_or(true);
    core_options.broken_image = options.broken_image.unwrap_or(true);
    let session = ScanSession::create(options.scan_id);
    Ok(AsyncTask::new(MediaScanTask { options: core_options, session, thread_count: options.thread_count.unwrap_or(0) as usize }))
}

impl Task for MediaScanTask {
    type Output = core::MediaScanResult;
    type JsValue = MediaScanResult;

    fn compute(&mut self) -> Result<Self::Output> {
        core::initialize_threads(self.thread_count);
        run_controlled(&self.session, |control| core::scan_media_files_controlled(self.options.clone(), control))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(MediaScanResult {
            groups: output
                .groups
                .into_iter()
                .map(|group| MediaGroup {
                    entries: group
                        .entries
                        .into_iter()
                        .map(|entry| MediaEntry {
                            path: entry.path.to_string_lossy().into_owned(),
                            size: saturating_i64(entry.size),
                            modified_date: saturating_i64(entry.modified_date),
                            width: entry.width,
                            height: entry.height,
                            similarity: entry.similarity,
                            title: entry.title,
                            artist: entry.artist,
                            year: entry.year,
                            length: entry.length,
                            genre: entry.genre,
                            bitrate: entry.bitrate,
                            is_reference: entry.is_reference,
                            detail: entry.detail,
                            proper_extension: entry.proper_extension,
                        })
                        .collect(),
                })
                .collect(),
            messages: output.messages,
            stopped: output.stopped,
        })
    }
}
