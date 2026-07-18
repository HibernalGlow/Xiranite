use std::path::PathBuf;
use std::sync::{Arc, Once, OnceLock};
use std::sync::atomic::AtomicBool;
use std::thread::JoinHandle;

use crossbeam_channel::{Receiver, Sender, unbounded};
use czkawka_core::common::config_cache_path::set_config_cache_path;
use czkawka_core::common::model::{CheckingMethod, HashType};
use czkawka_core::common::progress_data::ProgressData;
use czkawka_core::common::tool_data::CommonData;
use czkawka_core::common::traits::Search;
use czkawka_core::tools::bad_extensions::{BadExtensions, BadExtensionsParameters};
use czkawka_core::tools::big_file::{BigFile, BigFileParameters, SearchMode};
use czkawka_core::tools::broken_files::{BrokenFiles, BrokenFilesParameters, CheckedTypes};
use czkawka_core::tools::duplicate::{DuplicateEntry, DuplicateFinder, DuplicateFinderParameters};
use czkawka_core::tools::empty_files::EmptyFiles;
use czkawka_core::tools::empty_folder::EmptyFolder;
use czkawka_core::tools::invalid_symlinks::InvalidSymlinks;
use czkawka_core::tools::same_music::{MusicEntry, MusicSimilarity, SameMusic, SameMusicParameters};
use czkawka_core::tools::similar_images::{ImagesEntry, SimilarImages, SimilarImagesParameters};
use czkawka_core::tools::similar_videos::{SimilarVideos, SimilarVideosParameters, VideosEntry};
use czkawka_core::tools::temporary::Temporary;
use image_hasher::{FilterType, HashAlg};
use thiserror::Error;
use vid_dup_finder_lib::Cropdetect;

pub const API_VERSION: u32 = 4;

#[derive(Debug, Clone)]
pub struct ScanProgress {
    pub stage: String,
    pub stage_index: u8,
    pub stage_count: u8,
    pub entries_checked: usize,
    pub entries_total: usize,
    pub bytes_checked: u64,
    pub bytes_total: u64,
}

#[derive(Clone)]
pub struct ScanControl {
    stop: Arc<AtomicBool>,
    progress: Option<Sender<ScanProgress>>,
}

impl ScanControl {
    pub fn detached() -> Self { Self { stop: Arc::new(AtomicBool::new(false)), progress: None } }
    pub fn channel(stop: Arc<AtomicBool>) -> (Self, Receiver<ScanProgress>) { let (sender, receiver) = unbounded(); (Self { stop, progress: Some(sender) }, receiver) }
    fn start_progress_forwarder(&self) -> (Option<Sender<ProgressData>>, Option<JoinHandle<()>>) {
        let Some(target) = self.progress.clone() else { return (None, None) };
        let (sender, receiver) = unbounded::<ProgressData>();
        let handle = std::thread::spawn(move || while let Ok(progress) = receiver.recv() { let _ = target.send(ScanProgress { stage: format!("{:?}", progress.sstage), stage_index: progress.current_stage_idx, stage_count: progress.max_stage_idx.saturating_add(1), entries_checked: progress.entries_checked, entries_total: progress.entries_to_check, bytes_checked: progress.bytes_checked, bytes_total: progress.bytes_to_check }); });
        (Some(sender), Some(handle))
    }
}

pub fn initialize_threads(thread_count: usize) -> usize {
    static THREAD_COUNT: OnceLock<usize> = OnceLock::new();
    *THREAD_COUNT.get_or_init(|| { czkawka_core::common::set_number_of_threads(thread_count); czkawka_core::common::get_number_of_threads() })
}

fn search_with_control<T: Search>(tool: &mut T, control: &ScanControl) {
    let (progress, forwarder) = control.start_progress_forwarder();
    tool.search(&control.stop, progress.as_ref());
    drop(progress);
    if let Some(handle) = forwarder { let _ = handle.join(); }
}

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
    pub reference_directories: Vec<PathBuf>,
    pub excluded_directories: Vec<PathBuf>,
    pub excluded_items: Vec<String>,
    pub allowed_extensions: String,
    pub excluded_extensions: String,
    pub minimum_file_size: u64,
    pub maximum_file_size: u64,
    pub recursive: bool,
    pub use_cache: bool,
    pub save_also_as_json: bool,
    pub delete_outdated_cache: bool,
    pub minimal_cache_file_size: u64,
    pub minimal_prehash_cache_file_size: u64,
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
            reference_directories: Vec::new(),
            excluded_directories: Vec::new(),
            excluded_items: Vec::new(),
            allowed_extensions: String::new(),
            excluded_extensions: String::new(),
            minimum_file_size: 1,
            maximum_file_size: u64::MAX,
            recursive: true,
            use_cache: false,
            save_also_as_json: false,
            delete_outdated_cache: true,
            minimal_cache_file_size: 256 * 1024,
            minimal_prehash_cache_file_size: 256 * 1024,
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
    pub is_reference: bool,
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
    scan_duplicate_files_controlled(options, &ScanControl::detached())
}

pub fn scan_duplicate_files_controlled(
    options: DuplicateScanOptions,
    control: &ScanControl,
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
    initialize_cache_path();

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
        options.minimal_cache_file_size,
        options.minimal_prehash_cache_file_size,
        options.case_sensitive_names,
    ));
    finder.set_included_directory(options.included_directories);
    if !options.reference_directories.is_empty() {
        finder.set_reference_directory(options.reference_directories);
    }
    finder.set_excluded_directory(options.excluded_directories);
    finder.set_excluded_items(options.excluded_items);
    finder.set_allowed_extensions(options.allowed_extensions);
    finder.set_excluded_extensions(options.excluded_extensions);
    finder.set_minimal_file_size(options.minimum_file_size);
    finder.set_maximal_file_size(options.maximum_file_size);
    finder.set_recursive_search(options.recursive);
    finder.set_use_cache(options.use_cache);
    finder.set_save_also_as_json(options.save_also_as_json);
    finder.set_delete_outdated_cache(options.delete_outdated_cache);

    search_with_control(&mut finder, control);
    let raw_groups: Vec<Vec<(DuplicateEntry, bool)>> = if finder.get_use_reference() {
        match check_method {
            CheckingMethod::Hash => finder.get_files_with_identical_hashes_referenced().values().flatten().map(referenced_duplicate_group).collect(),
            CheckingMethod::Name => finder.get_files_with_identical_name_referenced().values().map(referenced_duplicate_group).collect(),
            CheckingMethod::Size => finder.get_files_with_identical_size_referenced().values().map(referenced_duplicate_group).collect(),
            CheckingMethod::SizeName => finder.get_files_with_identical_size_names_referenced().values().map(referenced_duplicate_group).collect(),
            _ => unreachable!(),
        }
    } else {
        match check_method {
            CheckingMethod::Hash => finder.get_files_sorted_by_hash().values().flatten().map(|group| group.iter().cloned().map(|entry| (entry, false)).collect()).collect(),
            CheckingMethod::Name => finder.get_files_sorted_by_names().values().map(|group| group.iter().cloned().map(|entry| (entry, false)).collect()).collect(),
            CheckingMethod::Size => finder.get_files_sorted_by_size().values().map(|group| group.iter().cloned().map(|entry| (entry, false)).collect()).collect(),
            CheckingMethod::SizeName => finder.get_files_sorted_by_size_name().values().map(|group| group.iter().cloned().map(|entry| (entry, false)).collect()).collect(),
            _ => unreachable!(),
        }
    };
    let groups = raw_groups
        .into_iter()
        .map(|mut entries| {
            entries.sort_unstable_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.path.cmp(&b.0.path)));
            DuplicateGroup {
                files: entries
                    .into_iter()
                    .map(|(entry, is_reference)| DuplicateFile {
                        path: entry.path,
                        modified_date: entry.modified_date,
                        size: entry.size,
                        hash: entry.hash,
                        is_reference,
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

fn referenced_duplicate_group(group: &(DuplicateEntry, Vec<DuplicateEntry>)) -> Vec<(DuplicateEntry, bool)> {
    std::iter::once((group.0.clone(), true))
        .chain(group.1.iter().cloned().map(|entry| (entry, false)))
        .collect()
}

#[derive(Debug, Clone, Copy)]
pub enum BasicTool {
    BigFiles,
    EmptyFiles,
    EmptyFolders,
    TemporaryFiles,
    InvalidSymlinks,
}

#[derive(Debug, Clone)]
pub struct BasicScanOptions {
    pub tool: BasicTool,
    pub included_directories: Vec<PathBuf>,
    pub reference_directories: Vec<PathBuf>,
    pub excluded_directories: Vec<PathBuf>,
    pub excluded_items: Vec<String>,
    pub allowed_extensions: String,
    pub excluded_extensions: String,
    pub recursive: bool,
    pub minimum_file_size: u64,
    pub maximum_file_size: u64,
    pub use_cache: bool,
    pub save_also_as_json: bool,
    pub delete_outdated_cache: bool,
    pub number_of_files: usize,
    pub biggest_first: bool,
}

impl BasicScanOptions {
    pub fn new(tool: BasicTool, included_directories: Vec<PathBuf>) -> Self {
        Self {
            tool,
            included_directories,
            reference_directories: Vec::new(),
            excluded_directories: Vec::new(),
            excluded_items: Vec::new(),
            allowed_extensions: String::new(),
            excluded_extensions: String::new(),
            recursive: true,
            minimum_file_size: 1,
            maximum_file_size: u64::MAX,
            use_cache: true,
            save_also_as_json: false,
            delete_outdated_cache: true,
            number_of_files: 50,
            biggest_first: true,
        }
    }
}

#[derive(Debug, Clone)]
pub struct BasicEntry {
    pub path: PathBuf,
    pub size: u64,
    pub modified_date: u64,
    pub secondary_path: Option<PathBuf>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone)]
pub struct BasicScanResult {
    pub entries: Vec<BasicEntry>,
    pub messages: String,
    pub stopped: bool,
}

pub fn scan_basic_files(options: BasicScanOptions) -> Result<BasicScanResult, CzkawkaError> {
    scan_basic_files_controlled(options, &ScanControl::detached())
}

pub fn scan_basic_files_controlled(options: BasicScanOptions, control: &ScanControl) -> Result<BasicScanResult, CzkawkaError> {
    initialize_cache_path();
    if options.included_directories.is_empty() {
        return Err(CzkawkaError::InvalidOption(
            "included_directories cannot be empty".into(),
        ));
    }
    match options.tool {
        BasicTool::BigFiles => {
            let mode = if options.biggest_first {
                SearchMode::BiggestFiles
            } else {
                SearchMode::SmallestFiles
            };
            let mut tool = BigFile::new(BigFileParameters::new(options.number_of_files, mode));
            configure_tool(&mut tool, &options);
            search_with_control(&mut tool, control);
            let entries = tool
                .get_big_files()
                .iter()
                .map(|entry| BasicEntry {
                    path: entry.path.clone(),
                    size: entry.size,
                    modified_date: entry.modified_date,
                    secondary_path: None,
                    detail: None,
                })
                .collect();
            Ok(basic_result(&tool, entries))
        }
        BasicTool::EmptyFiles => {
            let mut tool = EmptyFiles::new();
            configure_tool(&mut tool, &options);
            search_with_control(&mut tool, control);
            let entries = tool
                .get_empty_files()
                .iter()
                .map(|entry| BasicEntry {
                    path: entry.path.clone(),
                    size: entry.size,
                    modified_date: entry.modified_date,
                    secondary_path: None,
                    detail: None,
                })
                .collect();
            Ok(basic_result(&tool, entries))
        }
        BasicTool::EmptyFolders => {
            let mut tool = EmptyFolder::new();
            configure_tool(&mut tool, &options);
            search_with_control(&mut tool, control);
            let entries = tool
                .get_empty_folder_list()
                .values()
                .map(|entry| BasicEntry {
                    path: entry.path.clone(),
                    size: 0,
                    modified_date: entry.modified_date,
                    secondary_path: None,
                    detail: None,
                })
                .collect();
            Ok(basic_result(&tool, entries))
        }
        BasicTool::TemporaryFiles => {
            let mut tool = Temporary::new();
            configure_tool(&mut tool, &options);
            search_with_control(&mut tool, control);
            let entries = tool
                .get_temporary_files()
                .iter()
                .map(|entry| BasicEntry {
                    path: entry.path.clone(),
                    size: entry.size,
                    modified_date: entry.modified_date,
                    secondary_path: None,
                    detail: None,
                })
                .collect();
            Ok(basic_result(&tool, entries))
        }
        BasicTool::InvalidSymlinks => {
            let mut tool = InvalidSymlinks::new();
            configure_tool(&mut tool, &options);
            search_with_control(&mut tool, control);
            let entries = tool
                .get_invalid_symlinks()
                .iter()
                .map(|entry| BasicEntry {
                    path: entry.path.clone(),
                    size: entry.size,
                    modified_date: entry.modified_date,
                    secondary_path: Some(entry.symlink_info.destination_path.clone()),
                    detail: Some(entry.symlink_info.type_of_error.to_string()),
                })
                .collect();
            Ok(basic_result(&tool, entries))
        }
    }
}

fn configure_tool<T: CommonData>(tool: &mut T, options: &BasicScanOptions) {
    tool.set_included_directory(options.included_directories.clone());
    if !options.reference_directories.is_empty() {
        tool.set_reference_directory(options.reference_directories.clone());
    }
    tool.set_excluded_directory(options.excluded_directories.clone());
    tool.set_excluded_items(options.excluded_items.clone());
    tool.set_allowed_extensions(options.allowed_extensions.clone());
    tool.set_excluded_extensions(options.excluded_extensions.clone());
    tool.set_recursive_search(options.recursive);
    tool.set_minimal_file_size(options.minimum_file_size);
    tool.set_maximal_file_size(options.maximum_file_size);
    tool.set_use_cache(options.use_cache);
    tool.set_save_also_as_json(options.save_also_as_json);
    tool.set_delete_outdated_cache(options.delete_outdated_cache);
}

fn basic_result<T: CommonData>(tool: &T, mut entries: Vec<BasicEntry>) -> BasicScanResult {
    entries.sort_unstable_by(|left, right| left.path.cmp(&right.path));
    BasicScanResult {
        entries,
        messages: tool.get_text_messages().create_messages_text(),
        stopped: tool.get_stopped_search(),
    }
}

#[derive(Debug, Clone, Copy)]
pub enum MediaTool {
    SimilarImages,
    SimilarVideos,
    DuplicateMusic,
    BrokenFiles,
    BadExtensions,
}

#[derive(Debug, Clone, Copy, Default)]
pub enum ImageHashAlgorithm {
    #[default]
    Mean,
    Gradient,
    Blockhash,
    VertGradient,
    DoubleGradient,
    Median,
}

#[derive(Debug, Clone, Copy, Default)]
pub enum ImageResizeAlgorithm {
    #[default]
    Lanczos3,
    Gaussian,
    CatmullRom,
    Triangle,
    Nearest,
}

#[derive(Debug, Clone, Copy, Default)]
pub enum VideoCropDetect {
    #[default]
    Letterbox,
    Motion,
    None,
}

#[derive(Debug, Clone, Copy, Default)]
pub enum MusicCheckType {
    #[default]
    Tags,
    Fingerprint,
}

#[derive(Debug, Clone)]
pub struct MediaScanOptions {
    pub tool: MediaTool,
    pub included_directories: Vec<PathBuf>,
    pub reference_directories: Vec<PathBuf>,
    pub excluded_directories: Vec<PathBuf>,
    pub excluded_items: Vec<String>,
    pub allowed_extensions: String,
    pub excluded_extensions: String,
    pub recursive: bool,
    pub minimum_file_size: u64,
    pub maximum_file_size: u64,
    pub use_cache: bool,
    pub save_also_as_json: bool,
    pub delete_outdated_cache: bool,
    pub ignore_hard_links: bool,
    pub similarity: u32,
    pub image_hash_size: u8,
    pub image_hash_algorithm: ImageHashAlgorithm,
    pub image_resize_algorithm: ImageResizeAlgorithm,
    pub image_ignore_same_size: bool,
    pub video_ignore_same_size: bool,
    pub video_skip_forward: u32,
    pub video_hash_duration: u32,
    pub video_crop_detect: VideoCropDetect,
    pub music_check_type: MusicCheckType,
    pub music_approximate_comparison: bool,
    pub music_compare_title: bool,
    pub music_compare_artist: bool,
    pub music_compare_bitrate: bool,
    pub music_compare_genre: bool,
    pub music_compare_year: bool,
    pub music_compare_length: bool,
    pub music_maximum_difference: f64,
    pub music_minimum_fragment_duration: f32,
    pub music_compare_fingerprints_only_with_similar_titles: bool,
    pub broken_audio: bool,
    pub broken_pdf: bool,
    pub broken_archive: bool,
    pub broken_image: bool,
}

impl MediaScanOptions {
    pub fn new(tool: MediaTool, included_directories: Vec<PathBuf>) -> Self {
        Self {
            tool,
            included_directories,
            reference_directories: Vec::new(),
            excluded_directories: Vec::new(),
            excluded_items: Vec::new(),
            allowed_extensions: String::new(),
            excluded_extensions: String::new(),
            recursive: true,
            minimum_file_size: 1,
            maximum_file_size: u64::MAX,
            use_cache: true,
            save_also_as_json: false,
            delete_outdated_cache: true,
            ignore_hard_links: true,
            similarity: 10,
            image_hash_size: 16,
            image_hash_algorithm: ImageHashAlgorithm::Mean,
            image_resize_algorithm: ImageResizeAlgorithm::Lanczos3,
            image_ignore_same_size: false,
            video_ignore_same_size: false,
            video_skip_forward: 15,
            video_hash_duration: 10,
            video_crop_detect: VideoCropDetect::Letterbox,
            music_check_type: MusicCheckType::Tags,
            music_approximate_comparison: true,
            music_compare_title: true,
            music_compare_artist: true,
            music_compare_bitrate: false,
            music_compare_genre: false,
            music_compare_year: false,
            music_compare_length: false,
            music_maximum_difference: 10.0,
            music_minimum_fragment_duration: 15.0,
            music_compare_fingerprints_only_with_similar_titles: true,
            broken_audio: true,
            broken_pdf: true,
            broken_archive: true,
            broken_image: true,
        }
    }
}

#[derive(Debug, Clone)]
pub struct MediaEntry {
    pub path: PathBuf,
    pub size: u64,
    pub modified_date: u64,
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

#[derive(Debug, Clone)]
pub struct MediaGroup {
    pub entries: Vec<MediaEntry>,
}

#[derive(Debug, Clone)]
pub struct MediaScanResult {
    pub groups: Vec<MediaGroup>,
    pub messages: String,
    pub stopped: bool,
}

pub fn scan_media_files(options: MediaScanOptions) -> Result<MediaScanResult, CzkawkaError> {
    scan_media_files_controlled(options, &ScanControl::detached())
}

pub fn scan_media_files_controlled(options: MediaScanOptions, control: &ScanControl) -> Result<MediaScanResult, CzkawkaError> {
    initialize_cache_path();
    if options.included_directories.is_empty() {
        return Err(CzkawkaError::InvalidOption(
            "included_directories cannot be empty".into(),
        ));
    }
    match options.tool {
        MediaTool::SimilarImages => {
            let hash_algorithm = match options.image_hash_algorithm {
                ImageHashAlgorithm::Mean => HashAlg::Mean,
                ImageHashAlgorithm::Gradient => HashAlg::Gradient,
                ImageHashAlgorithm::Blockhash => HashAlg::Blockhash,
                ImageHashAlgorithm::VertGradient => HashAlg::VertGradient,
                ImageHashAlgorithm::DoubleGradient => HashAlg::DoubleGradient,
                ImageHashAlgorithm::Median => HashAlg::Median,
            };
            let resize_algorithm = match options.image_resize_algorithm {
                ImageResizeAlgorithm::Lanczos3 => FilterType::Lanczos3,
                ImageResizeAlgorithm::Gaussian => FilterType::Gaussian,
                ImageResizeAlgorithm::CatmullRom => FilterType::CatmullRom,
                ImageResizeAlgorithm::Triangle => FilterType::Triangle,
                ImageResizeAlgorithm::Nearest => FilterType::Nearest,
            };
            let mut tool = SimilarImages::new(SimilarImagesParameters::new(
                options.similarity.min(40),
                options.image_hash_size,
                hash_algorithm,
                resize_algorithm,
                options.image_ignore_same_size,
                options.ignore_hard_links,
            ));
            configure_media_tool(&mut tool, &options);
            search_with_control(&mut tool, control);
            let groups = if tool.get_use_reference() {
                tool.get_similar_images_referenced().iter().map(|(reference, others)| MediaGroup {
                    entries: std::iter::once(image_media_entry(reference, true))
                        .chain(others.iter().map(|entry| image_media_entry(entry, false)))
                        .collect(),
                }).collect()
            } else {
                tool.get_similar_images().iter().map(|group| MediaGroup {
                    entries: group.iter().map(|entry| image_media_entry(entry, false)).collect(),
                }).collect()
            };
            Ok(media_result(&tool, groups))
        }
        MediaTool::SimilarVideos => {
            let crop_detect = match options.video_crop_detect {
                VideoCropDetect::Letterbox => Cropdetect::Letterbox,
                VideoCropDetect::Motion => Cropdetect::Motion,
                VideoCropDetect::None => Cropdetect::None,
            };
            let mut tool = SimilarVideos::new(SimilarVideosParameters::new(
                options.similarity.min(20) as i32,
                options.video_ignore_same_size,
                options.ignore_hard_links,
                options.video_skip_forward,
                options.video_hash_duration,
                crop_detect,
            ));
            configure_media_tool(&mut tool, &options);
            search_with_control(&mut tool, control);
            let groups = if tool.get_use_reference() {
                tool.get_similar_videos_referenced().iter().map(|(reference, others)| MediaGroup {
                    entries: std::iter::once(video_media_entry(reference, true, 0.0))
                        .chain(others.iter().map(|entry| video_media_entry(entry, false, normalized_video_distance(reference, entry))))
                        .collect(),
                }).collect()
            } else {
                tool.get_similar_videos().iter().map(|group| MediaGroup {
                    entries: group.first().map(|baseline| group.iter().map(|entry| video_media_entry(entry, false, normalized_video_distance(baseline, entry))).collect()).unwrap_or_default(),
                }).collect()
            };
            Ok(media_result(&tool, groups))
        }
        MediaTool::DuplicateMusic => {
            let mut similarity = MusicSimilarity::NONE;
            if options.music_compare_title { similarity |= MusicSimilarity::TRACK_TITLE; }
            if options.music_compare_artist { similarity |= MusicSimilarity::TRACK_ARTIST; }
            if options.music_compare_bitrate { similarity |= MusicSimilarity::BITRATE; }
            if options.music_compare_genre { similarity |= MusicSimilarity::GENRE; }
            if options.music_compare_year { similarity |= MusicSimilarity::YEAR; }
            if options.music_compare_length { similarity |= MusicSimilarity::LENGTH; }
            if similarity == MusicSimilarity::NONE {
                similarity = MusicSimilarity::TRACK_TITLE | MusicSimilarity::TRACK_ARTIST;
            }
            let check_method = match options.music_check_type {
                MusicCheckType::Tags => CheckingMethod::AudioTags,
                MusicCheckType::Fingerprint => CheckingMethod::AudioContent,
            };
            let mut tool = SameMusic::new(SameMusicParameters::new(
                similarity,
                options.music_approximate_comparison,
                check_method,
                options.music_minimum_fragment_duration,
                options.music_maximum_difference,
                options.music_compare_fingerprints_only_with_similar_titles,
            ));
            configure_media_tool(&mut tool, &options);
            search_with_control(&mut tool, control);
            let groups = if tool.get_use_reference() {
                tool.get_similar_music_referenced().iter().map(|(reference, others)| MediaGroup {
                    entries: std::iter::once(music_media_entry(reference, true))
                        .chain(others.iter().map(|entry| music_media_entry(entry, false)))
                        .collect(),
                }).collect()
            } else {
                tool.get_duplicated_music_entries().iter().map(|group| MediaGroup {
                    entries: group.iter().map(|entry| music_media_entry(entry, false)).collect(),
                }).collect()
            };
            Ok(media_result(&tool, groups))
        }
        MediaTool::BrokenFiles => {
            let mut checked = CheckedTypes::NONE;
            if options.broken_audio { checked |= CheckedTypes::AUDIO; }
            if options.broken_pdf { checked |= CheckedTypes::PDF; }
            if options.broken_image { checked |= CheckedTypes::IMAGE; }
            if options.broken_archive { checked |= CheckedTypes::ARCHIVE; }
            if checked == CheckedTypes::NONE { checked = CheckedTypes::AUDIO; }
            let mut tool = BrokenFiles::new(BrokenFilesParameters::new(checked));
            configure_media_tool(&mut tool, &options);
            search_with_control(&mut tool, control);
            let entries = tool
                .get_broken_files()
                .iter()
                .map(|entry| MediaEntry {
                    path: entry.path.clone(),
                    size: entry.size,
                    modified_date: entry.modified_date,
                    width: None,
                    height: None,
                    similarity: None,
                    title: None,
                    artist: None,
                    year: None,
                    length: None,
                    genre: None,
                    bitrate: None,
                    is_reference: false,
                    detail: Some(format!("{:?}: {}", entry.type_of_file, entry.error_string)),
                    proper_extension: None,
                })
                .collect();
            Ok(media_result(&tool, vec![MediaGroup { entries }]))
        }
        MediaTool::BadExtensions => {
            let mut tool = BadExtensions::new(BadExtensionsParameters::new());
            configure_media_tool(&mut tool, &options);
            search_with_control(&mut tool, control);
            let entries = tool
                .get_bad_extensions_files()
                .iter()
                .map(|entry| MediaEntry {
                    path: entry.path.clone(),
                    size: entry.size,
                    modified_date: entry.modified_date,
                    width: None,
                    height: None,
                    similarity: None,
                    title: None,
                    artist: None,
                    year: None,
                    length: None,
                    genre: None,
                    bitrate: None,
                    is_reference: false,
                    detail: Some(format!("current: {}", entry.current_extension)),
                    proper_extension: Some(entry.proper_extension.clone()),
                })
                .collect();
            Ok(media_result(&tool, vec![MediaGroup { entries }]))
        }
    }
}

fn image_media_entry(entry: &ImagesEntry, is_reference: bool) -> MediaEntry {
    MediaEntry {
        path: entry.path.clone(), size: entry.size, modified_date: entry.modified_date,
        width: Some(entry.width), height: Some(entry.height), similarity: Some(entry.similarity.to_string()),
        title: None, artist: None, year: None, length: None, genre: None, bitrate: None,
        is_reference, detail: None, proper_extension: None,
    }
}

fn video_media_entry(entry: &VideosEntry, is_reference: bool, normalized_distance: f64) -> MediaEntry {
    MediaEntry {
        path: entry.path.clone(), size: entry.size, modified_date: entry.modified_date,
        width: None, height: None, similarity: Some(format!("{:.2}", normalized_distance * 100.0)), title: None, artist: None, year: None,
        length: None, genre: None, bitrate: None, is_reference,
        detail: (!entry.error.is_empty()).then(|| entry.error.clone()), proper_extension: None,
    }
}

fn normalized_video_distance(baseline: &VideosEntry, entry: &VideosEntry) -> f64 {
    // vid_dup_finder_lib 0.4 uses a fixed 10x10x10-bit hash; its normalized helper is test-feature-only.
    f64::from(baseline.vhash.hamming_distance(&entry.vhash)) / 1000.0
}

fn music_media_entry(entry: &MusicEntry, is_reference: bool) -> MediaEntry {
    MediaEntry {
        path: entry.path.clone(), size: entry.size, modified_date: entry.modified_date,
        width: None, height: None, similarity: None, title: Some(entry.track_title.clone()),
        artist: Some(entry.track_artist.clone()), year: Some(entry.year.clone()), length: Some(entry.length.clone()),
        genre: Some(entry.genre.clone()), bitrate: Some(entry.bitrate), is_reference,
        detail: Some(format!("{} · {} · {} kbps", entry.year, entry.genre, entry.bitrate)), proper_extension: None,
    }
}

fn configure_media_tool<T: CommonData>(tool: &mut T, options: &MediaScanOptions) {
    tool.set_included_directory(options.included_directories.clone());
    if !options.reference_directories.is_empty() {
        tool.set_reference_directory(options.reference_directories.clone());
    }
    tool.set_excluded_directory(options.excluded_directories.clone());
    tool.set_excluded_items(options.excluded_items.clone());
    tool.set_allowed_extensions(options.allowed_extensions.clone());
    tool.set_excluded_extensions(options.excluded_extensions.clone());
    tool.set_recursive_search(options.recursive);
    tool.set_minimal_file_size(options.minimum_file_size);
    tool.set_maximal_file_size(options.maximum_file_size);
    tool.set_use_cache(options.use_cache);
    tool.set_save_also_as_json(options.save_also_as_json);
    tool.set_delete_outdated_cache(options.delete_outdated_cache);
}

fn initialize_cache_path() {
    static INITIALIZE_CACHE_PATH: Once = Once::new();
    INITIALIZE_CACHE_PATH.call_once(|| {
        let _ = set_config_cache_path("xiranite", "xiranite");
    });
}

fn media_result<T: CommonData>(tool: &T, groups: Vec<MediaGroup>) -> MediaScanResult {
    MediaScanResult {
        groups,
        messages: tool.get_text_messages().create_messages_text(),
        stopped: tool.get_stopped_search(),
    }
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
