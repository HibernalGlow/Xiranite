#[cfg(any(
    test,
    all(
        unix,
        not(target_os = "macos"),
        not(target_os = "ios"),
        not(target_os = "android")
    )
))]
use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

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
const TRASH_LIST_CACHE_TTL: Duration = Duration::from_secs(5);

#[derive(Default)]
struct TrashListCache {
    items: Vec<trash::TrashItem>,
    refreshed_at: Option<Instant>,
    refreshing: bool,
}

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
        let receipt = delete_to_trash_with_receipt(&path)?;
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
        return Err(Error::new(
            Status::InvalidArg,
            "trash receipt is incomplete",
        ));
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
    all(
        unix,
        not(target_os = "macos"),
        not(target_os = "ios"),
        not(target_os = "android")
    )
))]
fn list_trash_items_native() -> Result<Vec<trash::TrashItem>> {
    let (cache, refreshed) = trash_list_cache();
    let mut state = cache.lock().expect("trash list cache mutex poisoned");
    loop {
        if state
            .refreshed_at
            .is_some_and(|updated| updated.elapsed() < TRASH_LIST_CACHE_TTL)
        {
            return Ok(state.items.clone());
        }
        if !state.refreshing {
            state.refreshing = true;
            break;
        }
        state = refreshed
            .wait(state)
            .expect("trash list cache mutex poisoned while waiting");
    }
    drop(state);

    let scanned = scan_trash_items_native();
    let mut state = cache.lock().expect("trash list cache mutex poisoned");
    state.refreshing = false;
    if let Ok(items) = &scanned {
        state.items.clone_from(items);
        state.refreshed_at = Some(Instant::now());
    }
    refreshed.notify_all();
    scanned
}

#[cfg(not(any(
    target_os = "windows",
    all(
        unix,
        not(target_os = "macos"),
        not(target_os = "ios"),
        not(target_os = "android")
    )
)))]
fn list_trash_items_native() -> Result<Vec<trash::TrashItem>> {
    require_trash_item_api()?;
    unreachable!()
}

#[cfg(any(
    target_os = "windows",
    all(
        unix,
        not(target_os = "macos"),
        not(target_os = "ios"),
        not(target_os = "android")
    )
))]
fn restore_trash_item_native(item: trash::TrashItem) -> Result<()> {
    let id = item.id.clone();
    trash::os_limited::restore_all([item]).map_err(trash_error)?;
    remove_cached_trash_item(&id);
    Ok(())
}

#[cfg(target_os = "windows")]
fn scan_trash_items_native() -> Result<Vec<trash::TrashItem>> {
    crate::windows_trash::list_trash_items().map_err(|error| {
        Error::from_reason(format!("Failed to enumerate the recycle bin: {error}"))
    })
}

#[cfg(all(
    unix,
    not(target_os = "macos"),
    not(target_os = "ios"),
    not(target_os = "android")
))]
fn scan_trash_items_native() -> Result<Vec<trash::TrashItem>> {
    trash::os_limited::list().map_err(trash_error)
}

#[cfg(not(any(
    target_os = "windows",
    all(
        unix,
        not(target_os = "macos"),
        not(target_os = "ios"),
        not(target_os = "android")
    )
)))]
fn restore_trash_item_native(_item: trash::TrashItem) -> Result<()> {
    require_trash_item_api()
}

#[cfg(target_os = "windows")]
fn delete_to_trash_with_receipt(path: &Path) -> Result<Option<trash::TrashItem>> {
    let receipt = crate::windows_trash::delete_to_trash_with_receipt(path)
        .map_err(|error| Error::from_reason(error.to_string()))?;
    if let Some(item) = &receipt {
        upsert_cached_trash_item(item);
    }
    Ok(receipt)
}

#[cfg(all(
    unix,
    not(target_os = "macos"),
    not(target_os = "ios"),
    not(target_os = "android")
))]
fn delete_to_trash_with_receipt(path: &Path) -> Result<Option<trash::TrashItem>> {
    let before = list_matching_trash_item_ids(path)?;
    trash::delete(path).map_err(trash_error)?;
    let receipt = find_new_trash_item(path, &before)?;
    if let Some(item) = &receipt {
        upsert_cached_trash_item(item);
    }
    Ok(receipt)
}

#[cfg(not(any(
    target_os = "windows",
    all(
        unix,
        not(target_os = "macos"),
        not(target_os = "ios"),
        not(target_os = "android")
    )
)))]
fn delete_to_trash_with_receipt(path: &Path) -> Result<Option<trash::TrashItem>> {
    trash::delete(path).map_err(trash_error)?;
    Ok(None)
}

#[cfg(all(
    unix,
    not(target_os = "macos"),
    not(target_os = "ios"),
    not(target_os = "android")
))]
fn list_matching_trash_item_ids(path: &Path) -> Result<HashSet<OsString>> {
    Ok(trash::os_limited::list()
        .map_err(trash_error)?
        .into_iter()
        .filter(|item| item.original_path() == path)
        .map(|item| item.id)
        .collect())
}

#[cfg(all(
    unix,
    not(target_os = "macos"),
    not(target_os = "ios"),
    not(target_os = "android")
))]
fn find_new_trash_item(
    path: &Path,
    before: &HashSet<OsString>,
) -> Result<Option<trash::TrashItem>> {
    let items = trash::os_limited::list().map_err(trash_error)?;
    Ok(select_new_trash_item(path, before, items))
}

#[cfg(any(
    test,
    all(
        unix,
        not(target_os = "macos"),
        not(target_os = "ios"),
        not(target_os = "android")
    )
))]
fn select_new_trash_item(
    path: &Path,
    before: &HashSet<OsString>,
    items: Vec<trash::TrashItem>,
) -> Option<trash::TrashItem> {
    items
        .into_iter()
        .filter(|item| item.original_path() == path && !before.contains(&item.id))
        .max_by(|left, right| {
            left.time_deleted
                .cmp(&right.time_deleted)
                .then_with(|| left.id.cmp(&right.id))
        })
}

fn trash_error(error: trash::Error) -> Error {
    Error::from_reason(error.to_string())
}

fn trash_list_cache() -> &'static (Mutex<TrashListCache>, Condvar) {
    static CACHE: OnceLock<(Mutex<TrashListCache>, Condvar)> = OnceLock::new();
    CACHE.get_or_init(|| (Mutex::new(TrashListCache::default()), Condvar::new()))
}

fn upsert_cached_trash_item(item: &trash::TrashItem) {
    let (cache, _) = trash_list_cache();
    let mut state = cache.lock().expect("trash list cache mutex poisoned");
    if state.refreshed_at.is_none() {
        return;
    }
    state
        .items
        .retain(|candidate| !trash_item_ids_equal(&candidate.id, &item.id));
    state.items.push(item.clone());
}

fn remove_cached_trash_item(id: &OsString) {
    let (cache, _) = trash_list_cache();
    let mut state = cache.lock().expect("trash list cache mutex poisoned");
    if state.refreshed_at.is_some() {
        state
            .items
            .retain(|candidate| !trash_item_ids_equal(&candidate.id, id));
    }
}

#[cfg(target_os = "windows")]
fn trash_item_ids_equal(left: &OsString, right: &OsString) -> bool {
    left.as_os_str().eq_ignore_ascii_case(right.as_os_str())
}

#[cfg(not(target_os = "windows"))]
fn trash_item_ids_equal(left: &OsString, right: &OsString) -> bool {
    left == right
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_latest_new_receipt_for_original_path() {
        let path = Path::new(r"D:\\archive\\test.txt");
        let existing_id = OsString::from("existing");
        let before = HashSet::from([existing_id.clone()]);
        let items = vec![
            trash_item(&existing_id.to_string_lossy(), path, 30),
            trash_item("other-path", Path::new(r"D:\\other\\test.txt"), 40),
            trash_item("older-new", path, 10),
            trash_item("latest-new", path, 20),
        ];

        let selected = select_new_trash_item(path, &before, items).unwrap();

        assert_eq!(selected.id, OsString::from("latest-new"));
    }

    fn trash_item(id: &str, original_path: &Path, time_deleted: i64) -> trash::TrashItem {
        trash::TrashItem {
            id: OsString::from(id),
            name: original_path.file_name().unwrap().to_owned(),
            original_parent: original_path.parent().unwrap().to_owned(),
            time_deleted,
        }
    }
}
