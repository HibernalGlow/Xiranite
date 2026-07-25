use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use napi::bindgen_prelude::{AsyncTask, Error, Result, Task};
use napi::{Env, Status};
use napi_derive::napi;
use rayon::prelude::*;
use slimg_core::{Format, PipelineOptions, convert, decode_file};

const API_VERSION: u32 = 1;

#[napi(object)]
pub struct SlimgInfo {
    pub api_version: u32,
    pub binding_version: String,
    pub formats: Vec<String>,
}

#[napi]
pub fn get_slimg_info() -> SlimgInfo {
    SlimgInfo {
        api_version: API_VERSION,
        binding_version: env!("CARGO_PKG_VERSION").to_owned(),
        formats: ["jpeg", "png", "webp", "avif", "jxl", "qoi"]
            .into_iter()
            .map(str::to_owned)
            .collect(),
    }
}

#[napi(object)]
pub struct BatchConvertFile {
    pub source_path: String,
    pub output_path: String,
}

#[napi(object)]
pub struct BatchConvertOptions {
    pub files: Vec<BatchConvertFile>,
    pub format: String,
    pub quality: Option<u32>,
    pub jobs: Option<u32>,
    pub overwrite: Option<bool>,
    pub batch_id: Option<String>,
}

#[napi(object)]
pub struct BatchConvertFileResult {
    pub source_path: String,
    pub output_path: String,
    pub success: bool,
    pub cancelled: bool,
    pub error: Option<String>,
    pub original_size: i64,
    pub output_size: i64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_ms: f64,
}

#[napi(object)]
pub struct BatchConvertResult {
    pub files: Vec<BatchConvertFileResult>,
    pub total: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub cancelled: u32,
    pub duration_ms: f64,
}

#[napi(object)]
pub struct SlimgBatchProgress {
    pub total: u32,
    pub completed: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub cancelled: u32,
}

#[derive(Default)]
struct BatchProgressState {
    total: u32,
    completed: AtomicU32,
    succeeded: AtomicU32,
    failed: AtomicU32,
    cancelled: AtomicU32,
}

impl BatchProgressState {
    fn snapshot(&self) -> SlimgBatchProgress {
        SlimgBatchProgress {
            total: self.total,
            completed: self.completed.load(Ordering::Relaxed),
            succeeded: self.succeeded.load(Ordering::Relaxed),
            failed: self.failed.load(Ordering::Relaxed),
            cancelled: self.cancelled.load(Ordering::Relaxed),
        }
    }

    fn record(&self, outcome: &FileOutcome) {
        match outcome {
            FileOutcome::Succeeded { .. } => {
                self.succeeded.fetch_add(1, Ordering::Relaxed);
            }
            FileOutcome::Failed { .. } => {
                self.failed.fetch_add(1, Ordering::Relaxed);
            }
            FileOutcome::Cancelled => {
                self.cancelled.fetch_add(1, Ordering::Relaxed);
            }
        }
        self.completed.fetch_add(1, Ordering::Relaxed);
    }
}

#[derive(Clone)]
struct BatchSession {
    id: String,
    stop: Arc<AtomicBool>,
    progress: Arc<BatchProgressState>,
}

fn batch_sessions() -> &'static Mutex<HashMap<String, BatchSession>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, BatchSession>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

impl BatchSession {
    fn create(id: Option<String>, total: u32) -> Option<Self> {
        let id = id?.trim().to_owned();
        if id.is_empty() {
            return None;
        }
        let session = Self {
            id: id.clone(),
            stop: Arc::new(AtomicBool::new(false)),
            progress: Arc::new(BatchProgressState {
                total,
                ..BatchProgressState::default()
            }),
        };
        if let Some(previous) = batch_sessions()
            .lock()
            .expect("batch session registry poisoned")
            .insert(id, session.clone())
        {
            previous.stop.store(true, Ordering::Relaxed);
        }
        Some(session)
    }

    fn finish(&self) {
        let mut sessions = batch_sessions()
            .lock()
            .expect("batch session registry poisoned");
        if sessions
            .get(&self.id)
            .is_some_and(|current| Arc::ptr_eq(&current.stop, &self.stop))
        {
            sessions.remove(&self.id);
        }
    }
}

#[napi]
pub fn cancel_slimg_batch(batch_id: String) -> bool {
    let sessions = batch_sessions()
        .lock()
        .expect("batch session registry poisoned");
    let Some(session) = sessions.get(batch_id.trim()) else {
        return false;
    };
    session.stop.store(true, Ordering::Relaxed);
    true
}

#[napi]
pub fn get_slimg_batch_progress(batch_id: String) -> Option<SlimgBatchProgress> {
    let sessions = batch_sessions()
        .lock()
        .expect("batch session registry poisoned");
    sessions
        .get(batch_id.trim())
        .map(|session| session.progress.snapshot())
}

struct ConvertFile {
    source_path: PathBuf,
    output_path: PathBuf,
}

pub struct BatchConvertTask {
    files: Vec<ConvertFile>,
    options: PipelineOptions,
    jobs: usize,
    overwrite: bool,
    session: Option<BatchSession>,
}

pub struct BatchOutput {
    files: Vec<FileOutput>,
    duration_ms: f64,
}

struct FileOutput {
    source_path: PathBuf,
    output_path: PathBuf,
    outcome: FileOutcome,
    duration_ms: f64,
}

enum FileOutcome {
    Succeeded {
        original_size: u64,
        output_size: u64,
        width: u32,
        height: u32,
    },
    Failed {
        error: String,
    },
    Cancelled,
}

#[napi]
pub fn convert_batch(options: BatchConvertOptions) -> Result<AsyncTask<BatchConvertTask>> {
    Ok(AsyncTask::new(build_batch_task(options)?))
}

fn build_batch_task(options: BatchConvertOptions) -> Result<BatchConvertTask> {
    if options.files.is_empty() {
        return Err(Error::new(
            Status::InvalidArg,
            "files must contain at least one item",
        ));
    }
    let total = u32::try_from(options.files.len()).map_err(|_| {
        Error::new(
            Status::InvalidArg,
            "files contains more items than the progress API can represent",
        )
    })?;
    let quality = options.quality.unwrap_or(80);
    if quality > 100 {
        return Err(Error::new(
            Status::InvalidArg,
            "quality must be between 0 and 100",
        ));
    }
    let jobs = options.jobs.unwrap_or(0) as usize;
    if jobs > 1024 {
        return Err(Error::new(
            Status::InvalidArg,
            "jobs must be zero or no greater than 1024",
        ));
    }
    let format = parse_format(&options.format)?;
    let files = options
        .files
        .into_iter()
        .map(|file| {
            if file.source_path.trim().is_empty() {
                return Err(Error::new(Status::InvalidArg, "sourcePath cannot be empty"));
            }
            if file.output_path.trim().is_empty() {
                return Err(Error::new(Status::InvalidArg, "outputPath cannot be empty"));
            }
            Ok(ConvertFile {
                source_path: PathBuf::from(file.source_path),
                output_path: PathBuf::from(file.output_path),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let session = BatchSession::create(options.batch_id, total);
    Ok(BatchConvertTask {
        files,
        options: PipelineOptions {
            format,
            quality: quality as u8,
            resize: None,
            crop: None,
            extend: None,
            fill_color: None,
        },
        jobs,
        overwrite: options.overwrite.unwrap_or(false),
        session,
    })
}

fn parse_format(value: &str) -> Result<Format> {
    match value.trim().to_ascii_lowercase().as_str() {
        "jpeg" | "jpg" => Ok(Format::Jpeg),
        "png" => Ok(Format::Png),
        "webp" => Ok(Format::WebP),
        "avif" => Ok(Format::Avif),
        "jxl" => Ok(Format::Jxl),
        "qoi" => Ok(Format::Qoi),
        value => Err(Error::new(
            Status::InvalidArg,
            format!("unsupported output format: {value}"),
        )),
    }
}

impl Task for BatchConvertTask {
    type Output = BatchOutput;
    type JsValue = BatchConvertResult;

    fn compute(&mut self) -> Result<Self::Output> {
        let started = Instant::now();
        let stop = self
            .session
            .as_ref()
            .map(|session| session.stop.clone())
            .unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
        let progress = self
            .session
            .as_ref()
            .map(|session| session.progress.clone());
        let mut pool_builder =
            rayon::ThreadPoolBuilder::new().thread_name(|index| format!("slimg-node-{index}"));
        if self.jobs > 0 {
            pool_builder = pool_builder.num_threads(self.jobs);
        }
        let output = pool_builder
            .build()
            .map_err(|error| Error::from_reason(format!("failed to create worker pool: {error}")))
            .map(|pool| {
                let files = pool.install(|| {
                    self.files
                        .par_iter()
                        .map(|file| {
                            let file_started = Instant::now();
                            let outcome = if stop.load(Ordering::Relaxed) {
                                FileOutcome::Cancelled
                            } else {
                                process_file(file, &self.options, self.overwrite)
                            };
                            if let Some(progress) = &progress {
                                progress.record(&outcome);
                            }
                            FileOutput {
                                source_path: file.source_path.clone(),
                                output_path: file.output_path.clone(),
                                outcome,
                                duration_ms: file_started.elapsed().as_secs_f64() * 1000.0,
                            }
                        })
                        .collect()
                });
                BatchOutput {
                    files,
                    duration_ms: started.elapsed().as_secs_f64() * 1000.0,
                }
            });
        if let Some(session) = &self.session {
            session.finish();
        }
        output
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        let mut succeeded = 0;
        let mut failed = 0;
        let mut cancelled = 0;
        let files = output
            .files
            .into_iter()
            .map(|file| {
                let source_path = file.source_path.to_string_lossy().into_owned();
                let output_path = file.output_path.to_string_lossy().into_owned();
                match file.outcome {
                    FileOutcome::Succeeded {
                        original_size,
                        output_size,
                        width,
                        height,
                    } => {
                        succeeded += 1;
                        BatchConvertFileResult {
                            source_path,
                            output_path,
                            success: true,
                            cancelled: false,
                            error: None,
                            original_size: saturating_i64(original_size),
                            output_size: saturating_i64(output_size),
                            width: Some(width),
                            height: Some(height),
                            duration_ms: file.duration_ms,
                        }
                    }
                    FileOutcome::Failed { error } => {
                        failed += 1;
                        BatchConvertFileResult {
                            source_path,
                            output_path,
                            success: false,
                            cancelled: false,
                            error: Some(error),
                            original_size: 0,
                            output_size: 0,
                            width: None,
                            height: None,
                            duration_ms: file.duration_ms,
                        }
                    }
                    FileOutcome::Cancelled => {
                        cancelled += 1;
                        BatchConvertFileResult {
                            source_path,
                            output_path,
                            success: false,
                            cancelled: true,
                            error: None,
                            original_size: 0,
                            output_size: 0,
                            width: None,
                            height: None,
                            duration_ms: file.duration_ms,
                        }
                    }
                }
            })
            .collect::<Vec<_>>();
        Ok(BatchConvertResult {
            total: files.len() as u32,
            files,
            succeeded,
            failed,
            cancelled,
            duration_ms: output.duration_ms,
        })
    }
}

impl Drop for BatchConvertTask {
    fn drop(&mut self) {
        if let Some(session) = &self.session {
            session.finish();
        }
    }
}

fn process_file(file: &ConvertFile, options: &PipelineOptions, overwrite: bool) -> FileOutcome {
    match try_process_file(file, options, overwrite) {
        Ok((original_size, output_size, width, height)) => FileOutcome::Succeeded {
            original_size,
            output_size,
            width,
            height,
        },
        Err(error) => FileOutcome::Failed { error },
    }
}

fn try_process_file(
    file: &ConvertFile,
    options: &PipelineOptions,
    overwrite: bool,
) -> std::result::Result<(u64, u64, u32, u32), String> {
    let original_size = fs::metadata(&file.source_path)
        .map_err(|error| format!("read metadata: {error}"))?
        .len();
    let (image, _) = decode_file(&file.source_path).map_err(|error| format!("decode: {error}"))?;
    let result = convert(&image, options).map_err(|error| format!("encode: {error}"))?;
    write_output(&file.output_path, &result.data, overwrite)
        .map_err(|error| format!("write output: {error}"))?;
    Ok((
        original_size,
        result.data.len() as u64,
        result.width,
        result.height,
    ))
}

fn write_output(path: &Path, data: &[u8], overwrite: bool) -> std::io::Result<()> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)?;
    }
    if overwrite {
        return fs::write(path, data);
    }
    let mut output = OpenOptions::new().write(true).create_new(true).open(path)?;
    output.write_all(data)
}

fn saturating_i64(value: u64) -> i64 {
    value.min(i64::MAX as u64) as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use slimg_core::ImageData;
    use tempfile::TempDir;

    #[test]
    fn parses_supported_formats() {
        assert_eq!(parse_format("jpg").unwrap(), Format::Jpeg);
        assert_eq!(parse_format("WEBP").unwrap(), Format::WebP);
        assert!(parse_format("bmp").is_err());
    }

    #[test]
    fn batch_converts_files_and_reports_errors_in_input_order() {
        let dir = TempDir::new().unwrap();
        let source = dir.path().join("source.qoi");
        let output = dir.path().join("output.png");
        let missing = dir.path().join("missing.qoi");
        let missing_output = dir.path().join("missing.png");
        let image = ImageData::new(8, 8, vec![128; 8 * 8 * 4]);
        let encoded = convert(
            &image,
            &PipelineOptions {
                format: Format::Qoi,
                quality: 80,
                resize: None,
                crop: None,
                extend: None,
                fill_color: None,
            },
        )
        .unwrap();
        fs::write(&source, encoded.data).unwrap();
        let mut task = build_batch_task(BatchConvertOptions {
            files: vec![
                BatchConvertFile {
                    source_path: source.to_string_lossy().into_owned(),
                    output_path: output.to_string_lossy().into_owned(),
                },
                BatchConvertFile {
                    source_path: missing.to_string_lossy().into_owned(),
                    output_path: missing_output.to_string_lossy().into_owned(),
                },
            ],
            format: "png".to_owned(),
            quality: Some(60),
            jobs: Some(2),
            overwrite: Some(false),
            batch_id: None,
        })
        .unwrap();
        let result = task.compute().unwrap();
        assert!(matches!(
            result.files[0].outcome,
            FileOutcome::Succeeded { .. }
        ));
        assert!(matches!(
            result.files[1].outcome,
            FileOutcome::Failed { .. }
        ));
        assert!(output.is_file());
        assert!(!missing_output.exists());
    }

    #[test]
    fn refuses_existing_output_without_overwrite() {
        let dir = TempDir::new().unwrap();
        let output = dir.path().join("output.bin");
        fs::write(&output, b"original").unwrap();
        let error = write_output(&output, b"replacement", false).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(output).unwrap(), b"original");
    }
}
