use windows::Win32::Storage::FileSystem::{
    GetDriveTypeW, GetLogicalDriveStringsW, GetVolumeInformationW,
};
use windows::core::PCWSTR;

use crate::{ArcThumbError, WindowsVolumeRoot};

pub fn list_volume_roots() -> Result<Vec<WindowsVolumeRoot>, ArcThumbError> {
    let required = unsafe { GetLogicalDriveStringsW(None) };
    if required == 0 {
        return Err(ArcThumbError::Platform(
            "GetLogicalDriveStringsW returned an empty result".into(),
        ));
    }
    let mut buffer = vec![0_u16; required as usize];
    let written = unsafe { GetLogicalDriveStringsW(Some(&mut buffer)) };
    if written == 0 || written >= required {
        return Err(ArcThumbError::Platform(format!(
            "GetLogicalDriveStringsW returned invalid length {written}"
        )));
    }

    let mut roots = Vec::new();
    for value in buffer[..written as usize].split(|unit| *unit == 0) {
        if value.is_empty() {
            continue;
        }
        let path = String::from_utf16(value).map_err(|_| {
            ArcThumbError::Platform("Windows returned an invalid UTF-16 volume root".into())
        })?;
        let mut wide_path = value.to_vec();
        wide_path.push(0);
        let drive_type = drive_type_name(unsafe { GetDriveTypeW(PCWSTR(wide_path.as_ptr())) });
        let mut label_buffer = [0_u16; 261];
        let available = unsafe {
            GetVolumeInformationW(
                PCWSTR(wide_path.as_ptr()),
                Some(&mut label_buffer),
                None,
                None,
                None,
                None,
            )
        }
        .is_ok();
        let label_length = label_buffer
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(label_buffer.len());
        let label = available
            .then(|| String::from_utf16_lossy(&label_buffer[..label_length]))
            .filter(|value| !value.is_empty());
        roots.push(WindowsVolumeRoot {
            path,
            label,
            drive_type,
            available,
        });
    }
    Ok(roots)
}

fn drive_type_name(value: u32) -> &'static str {
    match value {
        2 => "removable",
        3 => "fixed",
        4 => "network",
        5 => "optical",
        6 => "ramdisk",
        1 => "unavailable",
        _ => "unknown",
    }
}
