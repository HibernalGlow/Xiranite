use std::cmp::Ordering;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum SortOrder {
    Alphabetical,
    #[default]
    Natural,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum CoverMode {
    Ignore,
    #[default]
    Prefer,
    Only,
}

pub const SUPPORTED_IMAGE_EXTS: &[&str] = &[
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".bmp",
    ".tiff",
    ".tif",
    ".webp",
    ".ico",
    #[cfg(all(windows, feature = "wic"))]
    ".avif",
    #[cfg(all(windows, feature = "wic"))]
    ".jxl",
];

pub const fn default_enabled_image_exts_mask() -> u32 {
    (1u32 << SUPPORTED_IMAGE_EXTS.len()) - 1
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Settings {
    pub sort_order: SortOrder,
    pub cover_mode: CoverMode,
    pub enabled_image_exts_mask: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            sort_order: SortOrder::Natural,
            cover_mode: CoverMode::Prefer,
            enabled_image_exts_mask: default_enabled_image_exts_mask(),
        }
    }
}

impl Settings {
    pub fn accepts_image_ext(&self, name: &str) -> bool {
        SUPPORTED_IMAGE_EXTS.iter().enumerate().any(|(i, ext)| {
            (self.enabled_image_exts_mask & (1u32 << i)) != 0
                && ends_with_ignore_ascii_case(name, ext)
        })
    }

    pub fn pick_first_image(&self, mut names: Vec<String>) -> Option<String> {
        if names.is_empty() {
            return None;
        }
        match self.sort_order {
            SortOrder::Alphabetical => names.sort(),
            SortOrder::Natural => names.sort_by(|a, b| natural_cmp(a, b)),
        }
        match self.cover_mode {
            CoverMode::Ignore => names.into_iter().next(),
            CoverMode::Prefer => names
                .iter()
                .find(|name| is_cover_name(name))
                .cloned()
                .or_else(|| names.into_iter().next()),
            CoverMode::Only => names.into_iter().find(|name| is_cover_name(name)),
        }
    }
}

fn ends_with_ignore_ascii_case(value: &str, suffix: &str) -> bool {
    let value = value.as_bytes();
    let suffix = suffix.as_bytes();
    value.len() >= suffix.len()
        && value[value.len() - suffix.len()..]
            .iter()
            .zip(suffix)
            .all(|(a, b)| a.eq_ignore_ascii_case(b))
}

fn is_cover_name(path: &str) -> bool {
    let basename = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let stem = basename
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(basename);
    matches!(
        stem.to_ascii_lowercase().as_str(),
        "cover" | "folder" | "thumb" | "thumbnail" | "front"
    )
}

fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        if a[i].is_ascii_digit() && b[j].is_ascii_digit() {
            let a_start = i;
            while i < a.len() && a[i].is_ascii_digit() {
                i += 1;
            }
            let b_start = j;
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            let a_num = strip_leading_zeros(&a[a_start..i]);
            let b_num = strip_leading_zeros(&b[b_start..j]);
            match a_num.len().cmp(&b_num.len()).then_with(|| a_num.cmp(b_num)) {
                Ordering::Equal => continue,
                ordering => return ordering,
            }
        }
        match a[i].to_ascii_lowercase().cmp(&b[j].to_ascii_lowercase()) {
            Ordering::Equal => {
                i += 1;
                j += 1;
            }
            ordering => return ordering,
        }
    }
    a.len().cmp(&b.len())
}

fn strip_leading_zeros(value: &[u8]) -> &[u8] {
    let start = value
        .iter()
        .position(|&byte| byte != b'0')
        .unwrap_or(value.len());
    &value[start..]
}
