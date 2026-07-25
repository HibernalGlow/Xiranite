use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use napi::bindgen_prelude::{AsyncTask, Error, Result, Task};
use napi::{Env, Status};
use napi_derive::napi;

const TRASH_ITEM_API_SUPPORTED: bool = cfg!(any(
    target_os = "windows",
    all(
        unix,
        not(target_os = "macos"),
        not(target_os = "ios"),
        not(target_os = "android")
    )
));

#[napi(object)]
pub struct TrashCapabilities {
    pub delete_to_trash: bool,
    pub list: bool,
    pub restore: bool,
    pub provider: String,
    pub provider_version: String,
}

#[napi]
pub fn get_trash_capabilities() -> TrashCapabilities {
    TrashCapabilities {
        delete_to_trash: true,
        list: TRASH_ITEM_API_SUPPORTED,
        restore: TRASH_ITEM_API_SUPPORTED,
        provider: "trash-rs".into(),
        provider_version: "5.2.6".into(),
    }
}

#[napi(object)]
#[derive(Clone)]
pub struct TrashItemReceipt {
    pub id: String,
    pub name: String,
    pub original_parent: String,
    pub time_deleted: f64,
}

#[napi(object)]
pub struct TrashPathResult {
    pub trashed: bool,
    pub receipt: Option<TrashItemReceipt>,
}

pub struct TrashPathOutput {
    receipt: Option<trash::TrashItem>,
}

pub struct TrashPathTask {
    path: PathBuf,
}

#[napi]
pub fn trash_path(path: String) -> Result<AsyncTask<TrashPathTask>> {
    if path.trim().is_empty() {
        return Err(Error::new(Status::InvalidArg, "path cannot be empty"));
    }
    Ok(AsyncTask::new(TrashPathTask {
        path: PathBuf::from(path),
    }))
}

impl Task for TrashPathTask {
    type Output = TrashPathOutput;
    type JsValue = TrashPathResult;

    fn compute(&mut self) -> Result<Self::Output> {
        let path = canonical_target(&self.path)?;
        let before = list_matching_trash_item_ids(&path)?;
        trash::delete(&path).map_err(trash_error)?;
        let receipt = find_new_trash_item(&path, &before)?;
        Ok(TrashPathOutput { receipt })
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(TrashPathResult {
            trashed: true,
            receipt: output.receipt.map(to_trash_item_receipt),
        })
    }
}

pub struct ListTrashItemsTask;

#[napi]
pub fn list_trash_items() -> Result<AsyncTask<ListTrashItemsTask>> {
    require_trash_item_api()?;
    Ok(AsyncTask::new(ListTrashItemsTask))
}

impl Task for ListTrashItemsTask {
    type Output = Vec<trash::TrashItem>;
    type JsValue = Vec<TrashItemReceipt>;

    fn compute(&mut self) -> Result<Self::Output> {
        list_trash_items_native()
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into_iter().map(to_trash_item_receipt).collect())
    }
}

pub struct RestoreTrashItemTask {
    receipt: TrashItemReceipt,
}

#[napi]
pub fn restore_trash_item(receipt: TrashItemReceipt) -> Result<AsyncTask<RestoreTrashItemTask>> {
    require_trash_item_api()?;
    if receipt.id.is_empty() || receipt.name.is_empty() || receipt.original_parent.is_empty() {
        return Err(Error::new(Status::InvalidArg, "trash receipt is incomplete"));
    }
    Ok(AsyncTask::new(RestoreTrashItemTask { receipt }))
}

impl Task for RestoreTrashItemTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        restore_trash_item_native(to_native_trash_item(&self.receipt))
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        Ok(())
    }
}

fn canonical_target(path: &Path) -> Result<PathBuf> {
    let parent = path.parent().ok_or_else(|| {
        Error::new(
            Status::InvalidArg,
            "trash target cannot be a filesystem root",
        )
    })?;
    let canonical_parent = parent.canonicalize().map_err(|error| {
        Error::from_reason(format!(
            "Failed to resolve trash target parent {}: {error}",
            parent.display()
        ))
    })?;
    Ok(path
        .file_name()
        .map_or(canonical_parent.clone(), |name| canonical_parent.join(name)))
}

fn to_trash_item_receipt(item: trash::TrashItem) -> TrashItemReceipt {
    TrashItemReceipt {
        id: item.id.to_string_lossy().into_owned(),
        name: item.name.to_string_lossy().into_owned(),
        original_parent: item.original_parent.to_string_lossy().into_owned(),
        time_deleted: item.time_deleted as f64,
    }
}

fn to_native_trash_item(receipt: &TrashItemReceipt) -> trash::TrashItem {
    trash::TrashItem {
        id: OsString::from(&receipt.id),
        name: OsString::from(&receipt.name),
        original_parent: PathBuf::from(&receipt.original_parent),
        time_deleted: receipt.time_deleted as i64,
    }
}

fn require_trash_item_api() -> Result<()> {
    if TRASH_ITEM_API_SUPPORTED {
        Ok(())
    } else {
        Err(Error::new(
            Status::GenericFailure,
            "trash item listing and restore are unavailable on this platform",
        ))
    }
}

#[cfg(any(
    target_os = "windows",
    all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
))]
fn list_trash_items_native() -> Result<Vec<trash::TrashItem>> {
    trash::os_limited::list().map_err(trash_error)
}

#[cfg(not(any(
    target_os = "windows",
    all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
)))]
fn list_trash_items_native() -> Result<Vec<trash::TrashItem>> {
    require_trash_item_api()?;
    unreachable!()
}

#[cfg(any(
    target_os = "windows",
    all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
))]
fn restore_trash_item_native(item: trash::TrashItem) -> Result<()> {
    trash::os_limited::restore_all([item]).map_err(trash_error)
}

#[cfg(not(any(
    target_os = "windows",
    all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
)))]
fn restore_trash_item_native(_item: trash::TrashItem) -> Result<()> {
    require_trash_item_api()
}

fn list_matching_trash_item_ids(path: &Path) -> Result<HashSet<OsString>> {
    if !TRASH_ITEM_API_SUPPORTED {
        return Ok(HashSet::new());
    }
    Ok(list_trash_items_native()?
        .into_iter()
        .filter(|item| same_original_path(&item.original_path(), path))
        .map(|item| item.id)
        .collect())
}

fn find_new_trash_item(
    path: &Path,
    before: &HashSet<OsString>,
) -> Result<Option<trash::TrashItem>> {
    if !TRASH_ITEM_API_SUPPORTED {
        return Ok(None);
    }
    for attempt in 0..50 {
        let mut candidates = list_trash_items_native()?
            .into_iter()
            .filter(|item| {
                same_original_path(&item.original_path(), path) && !before.contains(&item.id)
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| {
            right
                .time_deleted
                .cmp(&left.time_deleted)
                .then_with(|| right.id.cmp(&left.id))
        });
        if let Some(item) = candidates.into_iter().next() {
            return Ok(Some(item));
        }
        if attempt < 49 {
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    Ok(None)
}

#[cfg(target_os = "windows")]
fn same_original_path(left: &Path, right: &Path) -> bool {
    comparable_windows_path(left) == comparable_windows_path(right)
}

#[cfg(target_os = "windows")]
fn comparable_windows_path(path: &Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    let value = if let Some(rest) = value.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{rest}")
    } else if let Some(rest) = value.strip_prefix("\\\\?\\") {
        rest.to_owned()
    } else {
        value
    };
    value.trim_end_matches('\\').to_lowercase()
}

#[cfg(not(target_os = "windows"))]
fn same_original_path(left: &Path, right: &Path) -> bool {
    left == right
}

fn trash_error(error: trash::Error) -> Error {
    Error::from_reason(error.to_string())
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::comparable_windows_path;
    use std::path::Path;

    #[test]
    fn compares_verbatim_and_regular_windows_paths() {
        assert_eq!(
            comparable_windows_path(Path::new(r"\\?\D:\Temp\File.txt")),
            comparable_windows_path(Path::new(r"d:\temp\file.txt")),
        );
        assert_eq!(
            comparable_windows_path(Path::new(r"\\?\UNC\server\share\File.txt")),
            comparable_windows_path(Path::new(r"\\server\share\file.txt")),
        );
    }
}
