use czkawka_core::tools::similar_videos::{SimilarVideos, SimilarVideosParameters, VideosEntry};
use vid_dup_finder_lib::Cropdetect;

use super::common::search_with_control;
use super::media::{configure_tool, result};
use crate::{
    CzkawkaError, MediaEntry, MediaGroup, MediaScanOptions, MediaScanResult, ScanControl,
    VideoCropDetect,
};

pub(crate) fn scan(
    options: MediaScanOptions,
    control: &ScanControl,
) -> Result<MediaScanResult, CzkawkaError> {
    let crop_detect = match options.video_crop_detect {
        VideoCropDetect::Letterbox => Cropdetect::Letterbox,
        VideoCropDetect::Motion => Cropdetect::Motion,
        VideoCropDetect::None => Cropdetect::None,
    };
    let mut tool = SimilarVideos::new(SimilarVideosParameters::new(
        options.similarity.min(20) as i32,
        options.video_ignore_same_size,
        options.ignore_hard_links,
        options.video_skip_forward,
        options.video_hash_duration,
        crop_detect,
    ));
    configure_tool(&mut tool, &options);
    search_with_control(&mut tool, control);
    let groups = if tool.get_use_reference() {
        tool.get_similar_videos_referenced()
            .iter()
            .map(|(reference, others)| MediaGroup {
                entries: std::iter::once(media_entry(reference, true, 0.0))
                    .chain(others.iter().map(|entry| {
                        media_entry(entry, false, normalized_distance(reference, entry))
                    }))
                    .collect(),
            })
            .collect()
    } else {
        tool.get_similar_videos()
            .iter()
            .map(|group| MediaGroup {
                entries: group
                    .first()
                    .map(|baseline| {
                        group
                            .iter()
                            .map(|entry| media_entry(entry, false, normalized_distance(baseline, entry)))
                            .collect()
                    })
                    .unwrap_or_default(),
            })
            .collect()
    };
    Ok(result(&tool, groups))
}

fn media_entry(entry: &VideosEntry, is_reference: bool, normalized_distance: f64) -> MediaEntry {
    MediaEntry {
        path: entry.path.clone(),
        size: entry.size,
        modified_date: entry.modified_date,
        width: None,
        height: None,
        similarity: Some(format!("{:.2}", normalized_distance * 100.0)),
        title: None,
        artist: None,
        year: None,
        length: None,
        genre: None,
        bitrate: None,
        is_reference,
        detail: (!entry.error.is_empty()).then(|| entry.error.clone()),
        proper_extension: None,
    }
}

fn normalized_distance(baseline: &VideosEntry, entry: &VideosEntry) -> f64 {
    // Czkawka 10 uses a fixed 10x10x10-bit hash. Czkawka 12 replaces this conversion.
    f64::from(baseline.vhash.hamming_distance(&entry.vhash)) / 1000.0
}
