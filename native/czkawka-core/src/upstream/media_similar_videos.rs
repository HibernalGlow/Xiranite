use czkawka_core::tools::similar_videos::{
    DEFAULT_AUDIO_LENGTH_RATIO, DEFAULT_AUDIO_MAXIMUM_DIFFERENCE,
    DEFAULT_AUDIO_MIN_DURATION_SECONDS, DEFAULT_AUDIO_SIMILARITY_PERCENT,
    DEFAULT_DURATION_TOLERANCE_PCT, DEFAULT_MIN_MATCHING_WINDOWS,
    DEFAULT_SUBCLIP_MIN_MATCH, DEFAULT_THUMBNAIL_GRID_TILES_PER_SIDE,
    DEFAULT_VIDEO_PERCENTAGE_FOR_THUMBNAIL, DEFAULT_WINDOW_COUNT, SimilarVideos,
    SimilarVideosParameters, VideosEntry,
};

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
        VideoCropDetect::Letterbox | VideoCropDetect::Motion => true,
        VideoCropDetect::None => false,
    };
    let mut tool = SimilarVideos::new(SimilarVideosParameters::new(
        options.similarity.min(20) as i32,
        options.video_ignore_same_size,
        false,
        options.video_skip_forward,
        options.video_hash_duration,
        crop_detect,
        DEFAULT_WINDOW_COUNT,
        DEFAULT_DURATION_TOLERANCE_PCT,
        DEFAULT_MIN_MATCHING_WINDOWS,
        DEFAULT_SUBCLIP_MIN_MATCH,
        false,
        DEFAULT_VIDEO_PERCENTAGE_FOR_THUMBNAIL,
        false,
        DEFAULT_THUMBNAIL_GRID_TILES_PER_SIDE,
        false,
        DEFAULT_AUDIO_SIMILARITY_PERCENT,
        DEFAULT_AUDIO_MAXIMUM_DIFFERENCE,
        DEFAULT_AUDIO_LENGTH_RATIO,
        DEFAULT_AUDIO_MIN_DURATION_SECONDS,
    ));
    configure_tool(&mut tool, &options);
    search_with_control(&mut tool, control);
    let groups = if tool.get_use_reference() {
        tool.get_similar_videos_referenced()
            .iter()
            .map(|(reference, others)| MediaGroup {
                entries: std::iter::once(media_entry(reference, true))
                    .chain(others.iter().map(|entry| media_entry(entry, false)))
                    .collect(),
            })
            .collect()
    } else {
        tool.get_similar_videos()
            .iter()
            .map(|group| MediaGroup {
                entries: group
                    .first()
                    .map(|_baseline| {
                        group
                            .iter()
                            .map(|entry| media_entry(entry, false))
                            .collect()
                    })
                    .unwrap_or_default(),
            })
            .collect()
    };
    Ok(result(&tool, groups))
}

fn media_entry(entry: &VideosEntry, is_reference: bool) -> MediaEntry {
    MediaEntry {
        path: entry.path.clone(),
        size: entry.size,
        modified_date: entry.modified_date,
        width: entry.width,
        height: entry.height,
        similarity: None,
        title: None,
        artist: None,
        year: None,
        length: entry.duration.map(|duration| format!("{duration:.2} s")),
        genre: None,
        bitrate: entry.bitrate.and_then(|bitrate| u32::try_from(bitrate).ok()),
        is_reference,
        detail: (!entry.error.is_empty()).then(|| entry.error.clone()),
        proper_extension: None,
    }
}
