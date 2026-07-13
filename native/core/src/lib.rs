mod arcthumb;

// Keep ArcThumb's original crate-relative module paths intact. This lets the
// imported core stay close to upstream while the public API remains ours.
#[allow(unused_imports)]
pub(crate) use arcthumb::{archive, decode, ebook, limits, settings};

use std::fs::File;
use std::io::{BufReader, Cursor};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Once;
use std::sync::atomic::AtomicBool;

use arcthumb::archive::{ContentKind, read_first_image_with_kind};
use arcthumb::settings::{CoverMode, Settings, SortOrder};
use czkawka_core::common::config_cache_path::set_config_cache_path;
use czkawka_core::common::model::{CheckingMethod, HashType};
use czkawka_core::common::tool_data::CommonData;
use czkawka_core::common::traits::Search;
use czkawka_core::tools::duplicate::{DuplicateEntry, DuplicateFinder, DuplicateFinderParameters};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat};
use thiserror::Error;

pub const API_VERSION: u32 = 1;
pub const ARCTHUMB_SOURCE_VERSION: &str = "0.10.1";

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("invalid option: {0}")]
    InvalidOption(String),
    #[error("cannot open {path}: {source}")]
    OpenFile {
        path: String,
        source: std::io::Error,
    },
    #[error("archive pipeline failed: {0}")]
    Archive(String),
    #[error("image encoding failed: {0}")]
    Encode(String),
}

#[derive(Debug, Clone)]
pub struct CoreInfo {
    pub api_version: u32,
    pub czkawka_version: &'static str,
    pub arcthumb_version: &'static str,
    pub archive_formats: &'static [&'static str],
}

pub fn core_info() -> CoreInfo {
    CoreInfo {
        api_version: API_VERSION,
        czkawka_version: czkawka_core::CZKAWKA_VERSION,
        arcthumb_version: ARCTHUMB_SOURCE_VERSION,
        archive_formats: &[
            "zip", "cbz", "7z", "cb7", "rar", "cbr", "tar", "cbt", "epub", "fb2", "mobi", "azw",
            "azw3",
        ],
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub enum ThumbnailFormat {
    #[default]
    Png,
    Jpeg,
    Webp,
}

#[derive(Debug, Clone, Copy, Default)]
pub enum ArchiveSortOrder {
    Alphabetical,
    #[default]
    Natural,
}

#[derive(Debug, Clone, Copy, Default)]
pub enum ArchiveCoverMode {
    Ignore,
    #[default]
    Prefer,
    Only,
}

#[derive(Debug, Clone)]
pub struct ArchiveThumbnailOptions {
    pub path: PathBuf,
    pub max_dimension: u32,
    pub format: ThumbnailFormat,
    pub quality: u8,
    pub sort_order: ArchiveSortOrder,
    pub cover_mode: ArchiveCoverMode,
}

impl ArchiveThumbnailOptions {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            max_dimension: 512,
            format: ThumbnailFormat::Png,
            quality: 85,
            sort_order: ArchiveSortOrder::Natural,
            cover_mode: ArchiveCoverMode::Prefer,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ArchiveThumbnail {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub source_name: String,
    pub content_kind: &'static str,
    pub mime_type: &'static str,
}

pub fn create_archive_thumbnail(
    options: ArchiveThumbnailOptions,
) -> Result<ArchiveThumbnail, CoreError> {
    if !(16..=8192).contains(&options.max_dimension) {
        return Err(CoreError::InvalidOption(
            "max_dimension must be between 16 and 8192".into(),
        ));
    }
    if options.quality == 0 || options.quality > 100 {
        return Err(CoreError::InvalidOption(
            "quality must be between 1 and 100".into(),
        ));
    }
    let file = File::open(&options.path).map_err(|source| CoreError::OpenFile {
        path: options.path.to_string_lossy().into_owned(),
        source,
    })?;
    let settings = Settings {
        sort_order: match options.sort_order {
            ArchiveSortOrder::Alphabetical => SortOrder::Alphabetical,
            ArchiveSortOrder::Natural => SortOrder::Natural,
        },
        cover_mode: match options.cover_mode {
            ArchiveCoverMode::Ignore => CoverMode::Ignore,
            ArchiveCoverMode::Prefer => CoverMode::Prefer,
            ArchiveCoverMode::Only => CoverMode::Only,
        },
        ..Settings::default()
    };
    let extracted = read_first_image_with_kind(BufReader::new(file), &settings)
        .map_err(|error| CoreError::Archive(error.to_string()))?;
    let decoded = arcthumb::decode::decode_for_thumbnail(
        &extracted.name,
        &extracted.bytes,
        options.max_dimension,
    )
    .map_err(|error| CoreError::Archive(error.to_string()))?;
    let resized = decoded.resize(
        options.max_dimension,
        options.max_dimension,
        FilterType::Lanczos3,
    );
    let (data, mime_type) = encode_image(&resized, options.format, options.quality)?;
    Ok(ArchiveThumbnail {
        data,
        width: resized.width(),
        height: resized.height(),
        source_name: extracted.name,
        content_kind: content_kind_name(extracted.kind),
        mime_type,
    })
}

fn encode_image(
    image: &DynamicImage,
    format: ThumbnailFormat,
    quality: u8,
) -> Result<(Vec<u8>, &'static str), CoreError> {
    let mut bytes = Vec::new();
    match format {
        ThumbnailFormat::Png => image
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .map_err(|error| CoreError::Encode(error.to_string()))?,
        ThumbnailFormat::Webp => image
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::WebP)
            .map_err(|error| CoreError::Encode(error.to_string()))?,
        ThumbnailFormat::Jpeg => JpegEncoder::new_with_quality(&mut bytes, quality)
            .encode_image(image)
            .map_err(|error| CoreError::Encode(error.to_string()))?,
    }
    Ok((
        bytes,
        match format {
            ThumbnailFormat::Png => "image/png",
            ThumbnailFormat::Jpeg => "image/jpeg",
            ThumbnailFormat::Webp => "image/webp",
        },
    ))
}

fn content_kind_name(kind: ContentKind) -> &'static str {
    match kind {
        ContentKind::Zip => "zip",
        ContentKind::SevenZ => "7z",
        ContentKind::Rar => "rar",
        ContentKind::Tar => "tar",
        ContentKind::Epub => "epub",
        ContentKind::Fb2 => "fb2",
        ContentKind::Mobi => "mobi",
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
) -> Result<DuplicateScanResult, CoreError> {
    if options.included_directories.is_empty() {
        return Err(CoreError::InvalidOption(
            "included_directories cannot be empty".into(),
        ));
    }
    if options.minimum_file_size > options.maximum_file_size {
        return Err(CoreError::InvalidOption(
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
    use std::fs::{self, File};
    use std::io::{Cursor, Write};

    use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
    use tempfile::tempdir;
    use zip::ZipWriter;
    use zip::write::SimpleFileOptions;

    use super::*;

    fn png(width: u32, height: u32, color: [u8; 4]) -> Vec<u8> {
        let image: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_fn(width, height, |_, _| Rgba(color));
        let mut bytes = Vec::new();
        DynamicImage::ImageRgba8(image)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        bytes
    }

    #[test]
    fn archive_thumbnail_prefers_named_cover() {
        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("comic.cbz");
        let file = File::create(&archive_path).unwrap();
        let mut zip = ZipWriter::new(file);
        zip.start_file("page01.png", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(&png(20, 40, [255, 0, 0, 255])).unwrap();
        zip.start_file("cover.png", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(&png(40, 20, [0, 255, 0, 255])).unwrap();
        zip.finish().unwrap();

        let mut options = ArchiveThumbnailOptions::new(&archive_path);
        options.max_dimension = 32;
        let result = create_archive_thumbnail(options).unwrap();
        assert_eq!(result.source_name, "cover.png");
        assert_eq!((result.width, result.height), (32, 16));
        assert_eq!(result.mime_type, "image/png");
        assert!(!result.data.is_empty());
    }

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
