use czkawka_core::common::tool_data::CommonData;

use super::common::initialize_cache_path;
use crate::{CzkawkaError, MediaScanOptions, MediaScanResult, MediaTool, ScanControl};

pub(crate) fn scan_media_files_controlled(
    options: MediaScanOptions,
    control: &ScanControl,
) -> Result<MediaScanResult, CzkawkaError> {
    initialize_cache_path();
    if options.included_directories.is_empty() {
        return Err(CzkawkaError::InvalidOption(
            "included_directories cannot be empty".into(),
        ));
    }
    match options.tool {
        MediaTool::SimilarImages => super::media_similar_images::scan(options, control),
        MediaTool::SimilarVideos => super::media_similar_videos::scan(options, control),
        MediaTool::DuplicateMusic => super::media_same_music::scan(options, control),
        MediaTool::BrokenFiles => super::media_broken_files::scan(options, control),
        MediaTool::BadExtensions => super::media_bad_extensions::scan(options, control),
    }
}

pub(crate) fn configure_tool<T: CommonData>(tool: &mut T, options: &MediaScanOptions) {
    tool.set_included_directory(options.included_directories.clone());
    if !options.reference_directories.is_empty() {
        tool.set_reference_directory(options.reference_directories.clone());
    }
    tool.set_excluded_directory(options.excluded_directories.clone());
    tool.set_excluded_items(options.excluded_items.clone());
    tool.set_allowed_extensions(options.allowed_extensions.clone());
    tool.set_excluded_extensions(options.excluded_extensions.clone());
    tool.set_recursive_search(options.recursive);
    tool.set_minimal_file_size(options.minimum_file_size);
    tool.set_maximal_file_size(options.maximum_file_size);
    tool.set_use_cache(options.use_cache);
    tool.set_save_also_as_json(options.save_also_as_json);
    tool.set_delete_outdated_cache(options.delete_outdated_cache);
}

pub(crate) fn result<T: CommonData>(tool: &T, groups: Vec<crate::MediaGroup>) -> MediaScanResult {
    MediaScanResult {
        groups,
        messages: tool.get_text_messages().create_messages_text(),
        stopped: tool.get_stopped_search(),
    }
}
