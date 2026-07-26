use czkawka_core::tools::similar_images::{ImagesEntry, SimilarImages, SimilarImagesParameters};
use image_hasher::{FilterType, HashAlg};

use super::common::search_with_control;
use super::media::{configure_tool, result};
use crate::{
    CzkawkaError, ImageHashAlgorithm, ImageResizeAlgorithm, MediaEntry, MediaGroup,
    MediaScanOptions, MediaScanResult, ScanControl,
};

pub(crate) fn scan(
    options: MediaScanOptions,
    control: &ScanControl,
) -> Result<MediaScanResult, CzkawkaError> {
    let hash_algorithm = match options.image_hash_algorithm {
        ImageHashAlgorithm::Mean => HashAlg::Mean,
        ImageHashAlgorithm::Gradient => HashAlg::Gradient,
        ImageHashAlgorithm::Blockhash => HashAlg::Blockhash,
        ImageHashAlgorithm::VertGradient => HashAlg::VertGradient,
        ImageHashAlgorithm::DoubleGradient => HashAlg::DoubleGradient,
        ImageHashAlgorithm::Median => HashAlg::Median,
    };
    let resize_algorithm = match options.image_resize_algorithm {
        ImageResizeAlgorithm::Lanczos3 => FilterType::Lanczos3,
        ImageResizeAlgorithm::Gaussian => FilterType::Gaussian,
        ImageResizeAlgorithm::CatmullRom => FilterType::CatmullRom,
        ImageResizeAlgorithm::Triangle => FilterType::Triangle,
        ImageResizeAlgorithm::Nearest => FilterType::Nearest,
    };
    let mut tool = SimilarImages::new(SimilarImagesParameters::new(
        options.similarity.min(40),
        options.image_hash_size,
        hash_algorithm,
        resize_algorithm,
        options.image_ignore_same_size,
        options.ignore_hard_links,
    ));
    configure_tool(&mut tool, &options);
    search_with_control(&mut tool, control);
    let groups = if tool.get_use_reference() {
        tool.get_similar_images_referenced()
            .iter()
            .map(|(reference, others)| MediaGroup {
                entries: std::iter::once(media_entry(reference, true))
                    .chain(others.iter().map(|entry| media_entry(entry, false)))
                    .collect(),
            })
            .collect()
    } else {
        tool.get_similar_images()
            .iter()
            .map(|group| MediaGroup {
                entries: group.iter().map(|entry| media_entry(entry, false)).collect(),
            })
            .collect()
    };
    Ok(result(&tool, groups))
}

fn media_entry(entry: &ImagesEntry, is_reference: bool) -> MediaEntry {
    MediaEntry {
        path: entry.path.clone(),
        size: entry.size,
        modified_date: entry.modified_date,
        width: Some(entry.width),
        height: Some(entry.height),
        similarity: Some(entry.similarity.to_string()),
        title: None,
        artist: None,
        year: None,
        length: None,
        genre: None,
        bitrate: None,
        is_reference,
        detail: None,
        proper_extension: None,
    }
}
