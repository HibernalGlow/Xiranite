#[derive(Debug, Clone)]
pub struct CzkawkaInfo {
    pub api_version: u32,
    pub source_version: &'static str,
    pub capabilities: &'static [&'static str],
}

pub const API_VERSION: u32 = 5;
pub const CAPABILITIES: &[&str] = &[
    "scan.duplicate",
    "scan.basic",
    "scan.media",
    "scan.progress.v2",
    "scan.cancel",
    "similar-images.geometric-invariance",
    "similar-images.same-resolution-exclusion",
    "similar-videos.similario",
    "similar-videos.same-resolution-exclusion",
    "similar-videos.audio",
    "broken-files.multi-checker",
    "empty-files.content-checkers",
    "operation.trash.list",
    "operation.trash.restore",
];

pub fn info(source_version: &'static str) -> CzkawkaInfo {
    CzkawkaInfo {
        api_version: API_VERSION,
        source_version,
        capabilities: CAPABILITIES,
    }
}
