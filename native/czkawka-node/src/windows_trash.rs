use std::ffi::{OsStr, OsString, c_void};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use windows::Win32::Foundation::E_ABORT;
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
    CoUninitialize,
};
use windows::Win32::UI::Shell::{
    FOF_ALLOWUNDO, FOF_NO_UI, FOF_WANTNUKEWARNING, FileOperation, IFileOperation,
    IFileOperationProgressSink, IFileOperationProgressSink_Impl, IShellItem,
    SHCreateItemFromParsingName, SIGDN_DESKTOPABSOLUTEPARSING,
};
use windows::core::{HRESULT, PCWSTR, implement};

pub fn delete_to_trash_with_receipt(
    path: &Path,
) -> windows::core::Result<Option<trash::TrashItem>> {
    let _apartment =
        ComApartment::initialize().map_err(|error| context("CoInitializeEx", error))?;
    let source_item = shell_item_from_path(path)
        .map_err(|error| context("SHCreateItemFromParsingName", error))?;
    let sink = DeleteProgressSink::new(path);
    let receipt = sink.receipt.clone();
    let sink_interface: IFileOperationProgressSink = sink.into();

    unsafe {
        let operation: IFileOperation =
            CoCreateInstance(&FileOperation as *const _, None, CLSCTX_ALL)
                .map_err(|error| context("CoCreateInstance(FileOperation)", error))?;
        operation
            .SetOperationFlags(FOF_NO_UI | FOF_ALLOWUNDO | FOF_WANTNUKEWARNING)
            .map_err(|error| context("IFileOperation::SetOperationFlags", error))?;
        let cookie = operation
            .Advise(&sink_interface)
            .map_err(|error| context("IFileOperation::Advise", error))?;
        let queued = operation
            .DeleteItem(&source_item, None)
            .map_err(|error| context("IFileOperation::DeleteItem", error));
        let performed = queued.and_then(|()| {
            operation
                .PerformOperations()
                .map_err(|error| context("IFileOperation::PerformOperations", error))
        });
        let _ = operation.Unadvise(cookie);
        performed?;
        if operation
            .GetAnyOperationsAborted()
            .map_err(|error| context("IFileOperation::GetAnyOperationsAborted", error))?
            .as_bool()
        {
            return Err(windows::core::Error::from(E_ABORT));
        }
    }

    Ok(receipt
        .lock()
        .expect("delete progress receipt mutex poisoned")
        .clone())
}

fn context(stage: &str, error: windows::core::Error) -> windows::core::Error {
    windows::core::Error::new(error.code(), format!("{stage}: {error}"))
}

fn shell_item_from_path(path: &Path) -> windows::core::Result<IShellItem> {
    let path = strip_verbatim_prefix(path);
    let wide = to_wide(path.as_os_str());
    unsafe { SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None) }
}

fn strip_verbatim_prefix(path: &Path) -> PathBuf {
    let value = path.as_os_str().to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = value.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path.to_owned()
    }
}

fn to_wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(std::iter::once(0)).collect()
}

fn recycle_item_id(item: &IShellItem) -> windows::core::Result<OsString> {
    let value = unsafe { item.GetDisplayName(SIGDN_DESKTOPABSOLUTEPARSING)? };
    let result = unsafe {
        let mut length = 0;
        while *value.0.add(length) != 0 {
            length += 1;
        }
        OsString::from_wide(std::slice::from_raw_parts(value.0, length))
    };
    unsafe { CoTaskMemFree(Some(value.0.cast::<c_void>())) };
    Ok(result)
}

#[implement(IFileOperationProgressSink)]
struct DeleteProgressSink {
    original_parent: PathBuf,
    name: OsString,
    receipt: Arc<Mutex<Option<trash::TrashItem>>>,
}

impl DeleteProgressSink {
    fn new(path: &Path) -> Self {
        Self {
            original_parent: strip_verbatim_prefix(path.parent().unwrap_or(path)),
            name: path.file_name().unwrap_or_default().to_owned(),
            receipt: Arc::new(Mutex::new(None)),
        }
    }
}

#[allow(non_snake_case)]
impl IFileOperationProgressSink_Impl for DeleteProgressSink {
    fn StartOperations(&self) -> windows::core::Result<()> {
        Ok(())
    }
    fn FinishOperations(&self, _result: HRESULT) -> windows::core::Result<()> {
        Ok(())
    }
    fn PreRenameItem(
        &self,
        _flags: u32,
        _item: Option<&IShellItem>,
        _new_name: &PCWSTR,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostRenameItem(
        &self,
        _flags: u32,
        _item: Option<&IShellItem>,
        _new_name: &PCWSTR,
        _result: HRESULT,
        _new_item: Option<&IShellItem>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PreMoveItem(
        &self,
        _flags: u32,
        _item: Option<&IShellItem>,
        _destination: Option<&IShellItem>,
        _new_name: &PCWSTR,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostMoveItem(
        &self,
        _flags: u32,
        _item: Option<&IShellItem>,
        _destination: Option<&IShellItem>,
        _new_name: &PCWSTR,
        _result: HRESULT,
        _new_item: Option<&IShellItem>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PreCopyItem(
        &self,
        _flags: u32,
        _item: Option<&IShellItem>,
        _destination: Option<&IShellItem>,
        _new_name: &PCWSTR,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostCopyItem(
        &self,
        _flags: u32,
        _item: Option<&IShellItem>,
        _destination: Option<&IShellItem>,
        _new_name: &PCWSTR,
        _result: HRESULT,
        _new_item: Option<&IShellItem>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PreDeleteItem(&self, _flags: u32, _item: Option<&IShellItem>) -> windows::core::Result<()> {
        Ok(())
    }

    fn PostDeleteItem(
        &self,
        _flags: u32,
        _item: Option<&IShellItem>,
        result: HRESULT,
        newly_created: Option<&IShellItem>,
    ) -> windows::core::Result<()> {
        result.ok()?;
        let Some(item) = newly_created else {
            return Ok(());
        };
        let receipt = trash::TrashItem {
            id: recycle_item_id(item)?,
            name: self.name.clone(),
            original_parent: self.original_parent.clone(),
            time_deleted: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64,
        };
        *self
            .receipt
            .lock()
            .expect("delete progress receipt mutex poisoned") = Some(receipt);
        Ok(())
    }

    fn PreNewItem(
        &self,
        _flags: u32,
        _destination: Option<&IShellItem>,
        _new_name: &PCWSTR,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostNewItem(
        &self,
        _flags: u32,
        _destination: Option<&IShellItem>,
        _new_name: &PCWSTR,
        _template_name: &PCWSTR,
        _attributes: u32,
        _result: HRESULT,
        _new_item: Option<&IShellItem>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn UpdateProgress(&self, _total: u32, _completed: u32) -> windows::core::Result<()> {
        Ok(())
    }
    fn ResetTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
    fn PauseTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
    fn ResumeTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
}

struct ComApartment;

impl ComApartment {
    fn initialize() -> windows::core::Result<Self> {
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()? };
        Ok(Self)
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}
