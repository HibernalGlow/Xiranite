use std::ffi::c_void;
use std::mem::{size_of, zeroed};

use windows::Win32::Foundation::{RPC_E_CHANGED_MODE, SIZE};
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, DeleteObject, GetDC, GetDIBits,
    GetObjectW, HBITMAP, HDC, HGDIOBJ, ReleaseDC,
};
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize};
use windows::Win32::UI::Shell::{
    IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF, SIIGBF_INCACHEONLY,
    SIIGBF_THUMBNAILONLY,
};
use windows::core::HSTRING;

use crate::{ArcThumbError, SystemThumbnail};

const MAX_DIMENSION: u32 = 2048;

pub fn get_cached_thumbnail(
    path: &str,
    max_dimension: u32,
) -> Result<Option<SystemThumbnail>, ArcThumbError> {
    if path.is_empty() {
        return Err(ArcThumbError::InvalidOption("path cannot be empty".into()));
    }
    if !(16..=MAX_DIMENSION).contains(&max_dimension) {
        return Err(ArcThumbError::InvalidOption(format!(
            "max_dimension must be between 16 and {MAX_DIMENSION}"
        )));
    }

    let _apartment = ComApartment::initialize()?;
    let factory: IShellItemImageFactory =
        match unsafe { SHCreateItemFromParsingName(&HSTRING::from(path), None) } {
            Ok(factory) => factory,
            Err(_) => return Ok(None),
        };
    let requested = i32::try_from(max_dimension)
        .map_err(|_| ArcThumbError::InvalidOption("max_dimension is outside i32 range".into()))?;
    let flags = SIIGBF(SIIGBF_INCACHEONLY.0 | SIIGBF_THUMBNAILONLY.0);
    let bitmap = match unsafe {
        factory.GetImage(
            SIZE {
                cx: requested,
                cy: requested,
            },
            flags,
        )
    } {
        Ok(bitmap) => OwnedBitmap(bitmap),
        Err(_) => return Ok(None),
    };
    bitmap.to_rgba(max_dimension).map(Some)
}

struct ComApartment(bool);

impl ComApartment {
    fn initialize() -> Result<Self, ArcThumbError> {
        let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if result.is_ok() {
            Ok(Self(true))
        } else if result == RPC_E_CHANGED_MODE {
            Ok(Self(false))
        } else {
            Err(ArcThumbError::Platform(format!(
                "CoInitializeEx returned {:#010x}",
                result.0 as u32
            )))
        }
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

struct OwnedBitmap(HBITMAP);

impl OwnedBitmap {
    fn to_rgba(&self, max_dimension: u32) -> Result<SystemThumbnail, ArcThumbError> {
        let mut bitmap: BITMAP = unsafe { zeroed() };
        let copied = unsafe {
            GetObjectW(
                HGDIOBJ(self.0.0),
                size_of::<BITMAP>() as i32,
                Some(&mut bitmap as *mut BITMAP as *mut c_void),
            )
        };
        if copied != size_of::<BITMAP>() as i32 {
            return Err(ArcThumbError::Platform(
                "GetObjectW returned incomplete bitmap metadata".into(),
            ));
        }
        let width = bitmap.bmWidth.unsigned_abs();
        let height = bitmap.bmHeight.unsigned_abs();
        if width == 0 || height == 0 || width > max_dimension || height > max_dimension {
            return Err(ArcThumbError::Platform(format!(
                "Shell returned invalid bitmap dimensions {width}x{height}"
            )));
        }
        let byte_len = (width as usize)
            .checked_mul(height as usize)
            .and_then(|value| value.checked_mul(4))
            .ok_or_else(|| ArcThumbError::Platform("Shell bitmap allocation overflow".into()))?;
        let mut rgba = vec![0_u8; byte_len];
        let mut info: BITMAPINFO = unsafe { zeroed() };
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            biSizeImage: byte_len as u32,
            ..Default::default()
        };
        let dc = WindowDc::acquire()?;
        let rows = unsafe {
            GetDIBits(
                dc.0,
                self.0,
                0,
                height,
                Some(rgba.as_mut_ptr() as *mut c_void),
                &mut info,
                DIB_RGB_COLORS,
            )
        };
        if rows != height as i32 {
            return Err(ArcThumbError::Platform(format!(
                "GetDIBits copied {rows} of {height} rows"
            )));
        }
        bgra_to_rgba(&mut rgba);
        Ok(SystemThumbnail {
            rgba,
            width,
            height,
            premultiplied: true,
        })
    }
}

impl Drop for OwnedBitmap {
    fn drop(&mut self) {
        let _ = unsafe { DeleteObject(HGDIOBJ(self.0.0)) };
    }
}

struct WindowDc(HDC);

impl WindowDc {
    fn acquire() -> Result<Self, ArcThumbError> {
        let dc = unsafe { GetDC(None) };
        if dc.is_invalid() {
            Err(ArcThumbError::Platform(
                "GetDC returned a null handle".into(),
            ))
        } else {
            Ok(Self(dc))
        }
    }
}

impl Drop for WindowDc {
    fn drop(&mut self) {
        let _ = unsafe { ReleaseDC(None, self.0) };
    }
}

fn bgra_to_rgba(pixels: &mut [u8]) {
    let has_alpha = pixels.chunks_exact(4).any(|pixel| pixel[3] != 0);
    for pixel in pixels.chunks_exact_mut(4) {
        pixel.swap(0, 2);
        if !has_alpha {
            pixel[3] = u8::MAX;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_bgra_and_repairs_opaque_bitmaps_without_alpha() {
        let mut pixels = vec![1, 2, 3, 0, 4, 5, 6, 0];
        bgra_to_rgba(&mut pixels);
        assert_eq!(pixels, vec![3, 2, 1, 255, 6, 5, 4, 255]);
    }

    #[test]
    fn preserves_meaningful_alpha() {
        let mut pixels = vec![1, 2, 3, 0, 4, 5, 6, 128];
        bgra_to_rgba(&mut pixels);
        assert_eq!(pixels, vec![3, 2, 1, 0, 6, 5, 4, 128]);
    }
}
