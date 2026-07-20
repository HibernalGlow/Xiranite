use napi::bindgen_prelude::{AsyncTask, Buffer, Error, Result, Task};
use napi::{Env, Status};
use napi_derive::napi;
use xiranite_arcthumb_core as core;

#[napi(object)]
pub struct ArcThumbInfo {
    pub api_version: u32,
    pub source_version: String,
    pub archive_formats: Vec<String>,
}

#[napi]
pub fn get_arc_thumb_info() -> ArcThumbInfo {
    let info = core::arcthumb_info();
    ArcThumbInfo {
        api_version: info.api_version,
        source_version: info.source_version.into(),
        archive_formats: info
            .archive_formats
            .iter()
            .map(|value| (*value).into())
            .collect(),
    }
}

#[napi(object)]
pub struct ArchiveThumbnailOptions {
    pub path: String,
    pub max_dimension: Option<u32>,
    pub format: Option<String>,
    pub lossless: Option<bool>,
    pub quality: Option<u32>,
    pub sort_order: Option<String>,
    pub cover_mode: Option<String>,
}

#[napi(object)]
pub struct ArchiveThumbnail {
    pub data: Buffer,
    pub width: u32,
    pub height: u32,
    pub source_name: String,
    pub content_kind: String,
    pub mime_type: String,
}

pub struct ArchiveThumbnailTask(core::ArchiveThumbnailOptions);

#[napi(object)]
pub struct SystemThumbnailOptions {
    pub path: String,
    pub max_dimension: Option<u32>,
}

#[napi(object)]
pub struct SystemThumbnail {
    pub rgba: Buffer,
    pub width: u32,
    pub height: u32,
    pub premultiplied: bool,
}

#[napi(object)]
pub struct EncodedSystemThumbnail {
    pub data: Buffer,
    pub width: u32,
    pub height: u32,
    pub mime_type: String,
}

#[napi(object)]
pub struct EncodedSystemThumbnailOptions {
    pub path: String,
    pub max_dimension: Option<u32>,
    pub format: Option<String>,
    pub lossless: Option<bool>,
    pub quality: Option<u32>,
}

pub struct EncodedSystemThumbnailTask {
    path: String,
    max_dimension: u32,
    format: core::ThumbnailFormat,
    lossless: bool,
    quality: u8,
}

pub struct SystemThumbnailTask {
    path: String,
    max_dimension: u32,
}

#[napi(object)]
pub struct WindowsVolumeRoot {
    pub path: String,
    pub label: Option<String>,
    pub drive_type: String,
    pub available: bool,
}

pub struct WindowsVolumeRootsTask;

#[napi]
pub fn list_windows_volume_roots() -> AsyncTask<WindowsVolumeRootsTask> {
    AsyncTask::new(WindowsVolumeRootsTask)
}

impl Task for WindowsVolumeRootsTask {
    type Output = Vec<core::WindowsVolumeRoot>;
    type JsValue = Vec<WindowsVolumeRoot>;

    fn compute(&mut self) -> Result<Self::Output> {
        core::list_windows_volume_roots().map_err(|error| Error::from_reason(error.to_string()))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output
            .into_iter()
            .map(|root| WindowsVolumeRoot {
                path: root.path,
                label: root.label,
                drive_type: root.drive_type.into(),
                available: root.available,
            })
            .collect())
    }
}

#[napi(object)]
pub struct WicImageThumbnailOptions {
    pub data: Buffer,
    pub max_dimension: Option<u32>,
}

#[napi(object)]
pub struct EncodedWicImageThumbnailOptions {
    pub data: Buffer,
    pub max_dimension: Option<u32>,
    pub format: Option<String>,
    pub lossless: Option<bool>,
    pub quality: Option<u32>,
}

pub struct EncodedWicImageThumbnailTask {
    data: Vec<u8>,
    max_dimension: u32,
    format: core::ThumbnailFormat,
    lossless: bool,
    quality: u8,
}

pub struct WicImageThumbnailTask {
    data: Vec<u8>,
    max_dimension: u32,
}

#[napi]
pub fn get_cached_system_thumbnail(
    options: SystemThumbnailOptions,
) -> Result<AsyncTask<SystemThumbnailTask>> {
    if options.path.is_empty() {
        return Err(Error::new(Status::InvalidArg, "path cannot be empty"));
    }
    let max_dimension = options.max_dimension.unwrap_or(416);
    if !(16..=2048).contains(&max_dimension) {
        return Err(Error::new(
            Status::InvalidArg,
            "maxDimension must be between 16 and 2048",
        ));
    }
    Ok(AsyncTask::new(SystemThumbnailTask {
        path: options.path,
        max_dimension,
    }))
}

impl Task for SystemThumbnailTask {
    type Output = Option<core::SystemThumbnail>;
    type JsValue = Option<SystemThumbnail>;

    fn compute(&mut self) -> Result<Self::Output> {
        core::get_cached_system_thumbnail(&self.path, self.max_dimension)
            .map_err(|error| Error::from_reason(error.to_string()))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.map(|thumbnail| SystemThumbnail {
            rgba: thumbnail.rgba.into(),
            width: thumbnail.width,
            height: thumbnail.height,
            premultiplied: thumbnail.premultiplied,
        }))
    }
}

#[napi]
pub fn get_cached_system_thumbnail_encoded(
    options: EncodedSystemThumbnailOptions,
) -> Result<AsyncTask<EncodedSystemThumbnailTask>> {
    if options.path.is_empty() {
        return Err(Error::new(Status::InvalidArg, "path cannot be empty"));
    }
    let max_dimension = options.max_dimension.unwrap_or(416);
    if !(16..=2048).contains(&max_dimension) {
        return Err(Error::new(
            Status::InvalidArg,
            "maxDimension must be between 16 and 2048",
        ));
    }
    Ok(AsyncTask::new(EncodedSystemThumbnailTask {
        path: options.path,
        max_dimension,
        format: parse_thumbnail_format(options.format.as_deref().unwrap_or("webp"))?,
        lossless: options.lossless.unwrap_or(false),
        quality: parse_quality(options.quality.unwrap_or(82))?,
    }))
}

impl Task for EncodedSystemThumbnailTask {
    type Output = Option<core::EncodedSystemThumbnail>;
    type JsValue = Option<EncodedSystemThumbnail>;

    fn compute(&mut self) -> Result<Self::Output> {
        core::get_cached_system_thumbnail_encoded(
            &self.path,
            self.max_dimension,
            self.format,
            self.lossless,
            self.quality,
        )
        .map_err(|error| Error::from_reason(error.to_string()))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.map(encoded_system_thumbnail))
    }
}

#[napi]
pub fn create_wic_image_thumbnail(
    options: WicImageThumbnailOptions,
) -> Result<AsyncTask<WicImageThumbnailTask>> {
    if options.data.is_empty() {
        return Err(Error::new(Status::InvalidArg, "data cannot be empty"));
    }
    let max_dimension = options.max_dimension.unwrap_or(416);
    if max_dimension != 0 && !(16..=8192).contains(&max_dimension) {
        return Err(Error::new(
            Status::InvalidArg,
            "maxDimension must be zero or between 16 and 8192",
        ));
    }
    Ok(AsyncTask::new(WicImageThumbnailTask {
        data: options.data.to_vec(),
        max_dimension,
    }))
}

impl Task for WicImageThumbnailTask {
    type Output = core::SystemThumbnail;
    type JsValue = SystemThumbnail;

    fn compute(&mut self) -> Result<Self::Output> {
        core::create_wic_image_thumbnail(&self.data, self.max_dimension)
            .map_err(|error| Error::from_reason(error.to_string()))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(SystemThumbnail {
            rgba: output.rgba.into(),
            width: output.width,
            height: output.height,
            premultiplied: output.premultiplied,
        })
    }
}

#[napi]
pub fn create_wic_image_thumbnail_encoded(
    options: EncodedWicImageThumbnailOptions,
) -> Result<AsyncTask<EncodedWicImageThumbnailTask>> {
    if options.data.is_empty() {
        return Err(Error::new(Status::InvalidArg, "data cannot be empty"));
    }
    let max_dimension = options.max_dimension.unwrap_or(416);
    if max_dimension != 0 && !(16..=8192).contains(&max_dimension) {
        return Err(Error::new(
            Status::InvalidArg,
            "maxDimension must be zero or between 16 and 8192",
        ));
    }
    Ok(AsyncTask::new(EncodedWicImageThumbnailTask {
        data: options.data.to_vec(),
        max_dimension,
        format: parse_thumbnail_format(options.format.as_deref().unwrap_or("webp"))?,
        lossless: options.lossless.unwrap_or(false),
        quality: parse_quality(options.quality.unwrap_or(82))?,
    }))
}

impl Task for EncodedWicImageThumbnailTask {
    type Output = core::EncodedSystemThumbnail;
    type JsValue = EncodedSystemThumbnail;

    fn compute(&mut self) -> Result<Self::Output> {
        core::create_wic_image_thumbnail_encoded(
            &self.data,
            self.max_dimension,
            self.format,
            self.lossless,
            self.quality,
        )
        .map_err(|error| Error::from_reason(error.to_string()))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(encoded_system_thumbnail(output))
    }
}

#[napi]
pub fn create_archive_thumbnail(
    options: ArchiveThumbnailOptions,
) -> Result<AsyncTask<ArchiveThumbnailTask>> {
    let mut core_options = core::ArchiveThumbnailOptions::new(options.path);
    core_options.max_dimension = options.max_dimension.unwrap_or(512);
    core_options.quality = parse_quality(options.quality.unwrap_or(85))?;
    core_options.format = parse_thumbnail_format(options.format.as_deref().unwrap_or("png"))?;
    core_options.lossless = options.lossless.unwrap_or(false);
    core_options.sort_order = match options.sort_order.as_deref().unwrap_or("natural") {
        "natural" => core::ArchiveSortOrder::Natural,
        "alphabetical" => core::ArchiveSortOrder::Alphabetical,
        value => {
            return Err(Error::new(
                Status::InvalidArg,
                format!("unsupported sort order: {value}"),
            ));
        }
    };
    core_options.cover_mode = match options.cover_mode.as_deref().unwrap_or("prefer") {
        "ignore" => core::ArchiveCoverMode::Ignore,
        "prefer" => core::ArchiveCoverMode::Prefer,
        "only" => core::ArchiveCoverMode::Only,
        value => {
            return Err(Error::new(
                Status::InvalidArg,
                format!("unsupported cover mode: {value}"),
            ));
        }
    };
    Ok(AsyncTask::new(ArchiveThumbnailTask(core_options)))
}

fn parse_quality(value: u32) -> Result<u8> {
    if !(1..=100).contains(&value) {
        return Err(Error::new(
            Status::InvalidArg,
            "quality must be between 1 and 100",
        ));
    }
    Ok(value as u8)
}

fn parse_thumbnail_format(value: &str) -> Result<core::ThumbnailFormat> {
    match value {
        "png" => Ok(core::ThumbnailFormat::Png),
        "jpeg" | "jpg" => Ok(core::ThumbnailFormat::Jpeg),
        "webp" => Ok(core::ThumbnailFormat::Webp),
        value => Err(Error::new(
            Status::InvalidArg,
            format!("unsupported thumbnail format: {value}"),
        )),
    }
}

fn encoded_system_thumbnail(output: core::EncodedSystemThumbnail) -> EncodedSystemThumbnail {
    EncodedSystemThumbnail {
        data: output.data.into(),
        width: output.width,
        height: output.height,
        mime_type: output.mime_type.into(),
    }
}

impl Task for ArchiveThumbnailTask {
    type Output = core::ArchiveThumbnail;
    type JsValue = ArchiveThumbnail;

    fn compute(&mut self) -> Result<Self::Output> {
        core::create_archive_thumbnail(self.0.clone())
            .map_err(|error| Error::from_reason(error.to_string()))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(ArchiveThumbnail {
            data: output.data.into(),
            width: output.width,
            height: output.height,
            source_name: output.source_name,
            content_kind: output.content_kind.into(),
            mime_type: output.mime_type.into(),
        })
    }
}
