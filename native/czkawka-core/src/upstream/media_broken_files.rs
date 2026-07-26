use czkawka_core::tools::broken_files::{BrokenFiles, BrokenFilesParameters, CheckedTypes};

use super::common::search_with_control;
use super::media::{configure_tool, result};
use crate::{CzkawkaError, MediaEntry, MediaGroup, MediaScanOptions, MediaScanResult, ScanControl};

pub(crate) fn scan(
    options: MediaScanOptions,
    control: &ScanControl,
) -> Result<MediaScanResult, CzkawkaError> {
    let mut checked = CheckedTypes::NONE;
    if options.broken_audio {
        checked |= CheckedTypes::AUDIO;
    }
    if options.broken_pdf {
        checked |= CheckedTypes::PDF;
    }
    if options.broken_image {
        checked |= CheckedTypes::IMAGE;
    }
    if options.broken_archive {
        checked |= CheckedTypes::ARCHIVE;
    }
    if checked == CheckedTypes::NONE {
        checked = CheckedTypes::AUDIO;
    }
    let mut tool = BrokenFiles::new(BrokenFilesParameters::new(checked));
    configure_tool(&mut tool, &options);
    search_with_control(&mut tool, control);
    let entries = tool
        .get_broken_files()
        .iter()
        .map(|entry| MediaEntry {
            path: entry.path.clone(),
            size: entry.size,
            modified_date: entry.modified_date,
            width: None,
            height: None,
            similarity: None,
            title: None,
            artist: None,
            year: None,
            length: None,
            genre: None,
            bitrate: None,
            is_reference: false,
            detail: Some(format!("{:?}: {}", entry.type_of_file, entry.error_string)),
            proper_extension: None,
        })
        .collect();
    Ok(result(&tool, vec![MediaGroup { entries }]))
}
