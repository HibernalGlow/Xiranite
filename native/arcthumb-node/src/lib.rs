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

#[napi]
pub fn create_archive_thumbnail(
    options: ArchiveThumbnailOptions,
) -> Result<AsyncTask<ArchiveThumbnailTask>> {
    let mut core_options = core::ArchiveThumbnailOptions::new(options.path);
    core_options.max_dimension = options.max_dimension.unwrap_or(512);
    core_options.quality = u8::try_from(options.quality.unwrap_or(85))
        .map_err(|_| Error::new(Status::InvalidArg, "quality is outside the u8 range"))?;
    core_options.format = match options.format.as_deref().unwrap_or("png") {
        "png" => core::ThumbnailFormat::Png,
        "jpeg" | "jpg" => core::ThumbnailFormat::Jpeg,
        "webp" => core::ThumbnailFormat::Webp,
        value => {
            return Err(Error::new(
                Status::InvalidArg,
                format!("unsupported thumbnail format: {value}"),
            ));
        }
    };
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
