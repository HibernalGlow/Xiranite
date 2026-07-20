mod arcthumb;
#[cfg(all(windows, feature = "windows-shell"))]
mod windows_shell;
#[cfg(all(windows, feature = "windows-shell"))]
mod windows_volumes;

// Keep ArcThumb's original crate-relative module paths intact. This lets the
// imported core stay close to upstream while the public API remains ours.
#[allow(unused_imports)]
pub(crate) use arcthumb::{archive, decode, ebook, limits, settings};

use std::fs::File;
use std::io::{BufReader, Cursor};
use std::path::PathBuf;

use arcthumb::archive::{ContentKind, read_first_image_with_kind};
use arcthumb::settings::{CoverMode, Settings, SortOrder};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat, RgbaImage};
use thiserror::Error;

pub const API_VERSION: u32 = 2;
pub const SOURCE_VERSION: &str = "0.10.1";

#[derive(Debug, Error)]
pub enum ArcThumbError {
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
    #[error("platform thumbnail failed: {0}")]
    Platform(String),
}

#[derive(Debug, Clone)]
pub struct ArcThumbInfo {
    pub api_version: u32,
    pub source_version: &'static str,
    pub archive_formats: &'static [&'static str],
}

pub fn arcthumb_info() -> ArcThumbInfo {
    ArcThumbInfo {
        api_version: API_VERSION,
        source_version: SOURCE_VERSION,
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
    pub lossless: bool,
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
            lossless: false,
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

#[derive(Debug, Clone)]
pub struct SystemThumbnail {
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub premultiplied: bool,
}

#[derive(Debug, Clone)]
pub struct EncodedSystemThumbnail {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub mime_type: &'static str,
}

#[derive(Debug, Clone)]
pub struct WindowsVolumeRoot {
    pub path: String,
    pub label: Option<String>,
    pub drive_type: &'static str,
    pub available: bool,
}

#[cfg(all(windows, feature = "windows-shell"))]
pub fn list_windows_volume_roots() -> Result<Vec<WindowsVolumeRoot>, ArcThumbError> {
    windows_volumes::list_volume_roots()
}

#[cfg(not(all(windows, feature = "windows-shell")))]
pub fn list_windows_volume_roots() -> Result<Vec<WindowsVolumeRoot>, ArcThumbError> {
    Ok(Vec::new())
}

#[cfg(all(windows, feature = "wic"))]
pub fn create_wic_image_thumbnail(
    bytes: &[u8],
    max_dimension: u32,
) -> Result<SystemThumbnail, ArcThumbError> {
    if max_dimension != 0 && !(16..=8192).contains(&max_dimension) {
        return Err(ArcThumbError::InvalidOption(
            "max_dimension must be zero or between 16 and 8192".into(),
        ));
    }
    let decoded = arcthumb::wic::decode_via_wic(bytes)
        .map_err(|error| ArcThumbError::Platform(error.to_string()))?;
    let resized = if max_dimension == 0 {
        decoded.to_rgba8()
    } else {
        decoded
            .resize(max_dimension, max_dimension, FilterType::Lanczos3)
            .to_rgba8()
    };
    Ok(SystemThumbnail {
        width: resized.width(),
        height: resized.height(),
        rgba: resized.into_raw(),
        premultiplied: false,
    })
}

pub fn create_wic_image_thumbnail_encoded(
    bytes: &[u8],
    max_dimension: u32,
    format: ThumbnailFormat,
    lossless: bool,
    quality: u8,
) -> Result<EncodedSystemThumbnail, ArcThumbError> {
    encode_system_thumbnail(
        create_wic_image_thumbnail(bytes, max_dimension)?,
        format,
        lossless,
        quality,
    )
}

#[cfg(not(all(windows, feature = "wic")))]
pub fn create_wic_image_thumbnail(
    _bytes: &[u8],
    max_dimension: u32,
) -> Result<SystemThumbnail, ArcThumbError> {
    if max_dimension != 0 && !(16..=8192).contains(&max_dimension) {
        return Err(ArcThumbError::InvalidOption(
            "max_dimension must be zero or between 16 and 8192".into(),
        ));
    }
    Err(ArcThumbError::Platform(
        "WIC image decoding is unavailable on this platform".into(),
    ))
}

#[cfg(all(windows, feature = "windows-shell"))]
pub fn get_cached_system_thumbnail(
    path: &str,
    max_dimension: u32,
) -> Result<Option<SystemThumbnail>, ArcThumbError> {
    windows_shell::get_cached_thumbnail(path, max_dimension)
}

pub fn get_cached_system_thumbnail_encoded(
    path: &str,
    max_dimension: u32,
    format: ThumbnailFormat,
    lossless: bool,
    quality: u8,
) -> Result<Option<EncodedSystemThumbnail>, ArcThumbError> {
    get_cached_system_thumbnail(path, max_dimension)?
        .map(|thumbnail| encode_system_thumbnail(thumbnail, format, lossless, quality))
        .transpose()
}

#[cfg(not(all(windows, feature = "windows-shell")))]
pub fn get_cached_system_thumbnail(
    _path: &str,
    max_dimension: u32,
) -> Result<Option<SystemThumbnail>, ArcThumbError> {
    if !(16..=2048).contains(&max_dimension) {
        return Err(ArcThumbError::InvalidOption(
            "max_dimension must be between 16 and 2048".into(),
        ));
    }
    Ok(None)
}

pub fn create_archive_thumbnail(
    options: ArchiveThumbnailOptions,
) -> Result<ArchiveThumbnail, ArcThumbError> {
    if !(16..=8192).contains(&options.max_dimension) {
        return Err(ArcThumbError::InvalidOption(
            "max_dimension must be between 16 and 8192".into(),
        ));
    }
    if options.quality == 0 || options.quality > 100 {
        return Err(ArcThumbError::InvalidOption(
            "quality must be between 1 and 100".into(),
        ));
    }
    let file = File::open(&options.path).map_err(|source| ArcThumbError::OpenFile {
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
        .map_err(|error| ArcThumbError::Archive(error.to_string()))?;
    let decoded = arcthumb::decode::decode_for_thumbnail(
        &extracted.name,
        &extracted.bytes,
        options.max_dimension,
    )
    .map_err(|error| ArcThumbError::Archive(error.to_string()))?;
    let resized = decoded.resize(
        options.max_dimension,
        options.max_dimension,
        FilterType::Lanczos3,
    );
    let (data, mime_type) =
        encode_image(&resized, options.format, options.lossless, options.quality)?;
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
    lossless: bool,
    quality: u8,
) -> Result<(Vec<u8>, &'static str), ArcThumbError> {
    let mut bytes = Vec::new();
    match format {
        ThumbnailFormat::Png => image
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .map_err(|error| ArcThumbError::Encode(error.to_string()))?,
        ThumbnailFormat::Webp => {
            let rgba = image.to_rgba8();
            let encoder = webp::Encoder::from_rgba(&rgba, rgba.width(), rgba.height());
            bytes = if lossless {
                encoder.encode_lossless().to_vec()
            } else {
                encoder.encode(f32::from(quality)).to_vec()
            };
        }
        ThumbnailFormat::Jpeg => JpegEncoder::new_with_quality(&mut bytes, quality)
            .encode_image(image)
            .map_err(|error| ArcThumbError::Encode(error.to_string()))?,
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

fn encode_system_thumbnail(
    mut thumbnail: SystemThumbnail,
    format: ThumbnailFormat,
    lossless: bool,
    quality: u8,
) -> Result<EncodedSystemThumbnail, ArcThumbError> {
    if thumbnail.premultiplied {
        unpremultiply_rgba(&mut thumbnail.rgba);
    }
    let image = RgbaImage::from_raw(thumbnail.width, thumbnail.height, thumbnail.rgba)
        .ok_or_else(|| ArcThumbError::Encode("system thumbnail RGBA length mismatch".into()))?;
    let (data, mime_type) =
        encode_image(&DynamicImage::ImageRgba8(image), format, lossless, quality)?;
    Ok(EncodedSystemThumbnail {
        data,
        width: thumbnail.width,
        height: thumbnail.height,
        mime_type,
    })
}

fn unpremultiply_rgba(pixels: &mut [u8]) {
    for pixel in pixels.chunks_exact_mut(4) {
        let alpha = u32::from(pixel[3]);
        if alpha == 0 {
            pixel[0] = 0;
            pixel[1] = 0;
            pixel[2] = 0;
        } else if alpha < 255 {
            for channel in &mut pixel[..3] {
                *channel = ((u32::from(*channel) * 255 + alpha / 2) / alpha).min(255) as u8;
            }
        }
    }
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

#[cfg(test)]
mod tests {
    use std::fs::File;
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
}
