//! ZIP backend — handles plain ZIPs, CBZ, EPUB, and FB2-inside-ZIP.

use std::error::Error;
use std::io::{Read, Seek, SeekFrom};

use super::ContentKind;
use crate::settings::Settings;
use crate::{ebook, limits};

/// Look for an `.fb2` entry inside an already-opened ZIP archive
/// (the `.fb2.zip` distribution convention). Returns `None` if no
/// `.fb2` entry exists or the FB2 cover extraction fails.
fn try_extract_fb2_from_zip<R: Read + Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> Option<(String, Vec<u8>)> {
    // First pass: find the first `.fb2` entry's name. We can't hold
    // a borrow into the archive across the second access so we copy
    // the name out.
    let fb2_name: String = (0..archive.len()).find_map(|i| {
        let f = archive.by_index(i).ok()?;
        if !f.is_file() {
            return None;
        }
        if !f.name().to_ascii_lowercase().ends_with(".fb2") {
            return None;
        }
        if f.size() > limits::MAX_ENTRY_SIZE {
            return None;
        }
        Some(f.name().to_string())
    })?;

    // Second pass: extract that entry's bytes and pass to the FB2
    // cover extractor.
    let mut entry = archive.by_name(&fb2_name).ok()?;
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut bytes).ok()?;
    ebook::fb2::try_extract_cover(&bytes)
}

pub(super) fn zip_read_first_image<R: Read + Seek>(
    mut reader: R,
    settings: &Settings,
) -> Result<(String, Vec<u8>, ContentKind), Box<dyn Error>> {
    reader.seek(SeekFrom::Start(0))?;
    let mut archive = zip::ZipArchive::new(reader)?;

    // Entry-count guard. `ZipArchive::new` has already populated its
    // internal list from the central directory, so a hostile archive
    // claiming billions of entries would have already caused trouble
    // by this point — but `len()` is still useful as a backstop and
    // bounds the work the downstream candidate loop will do.
    if archive.len() > limits::MAX_ARCHIVE_ENTRIES {
        return Err(format!(
            "archive has too many entries ({} > {} limit)",
            archive.len(),
            limits::MAX_ARCHIVE_ENTRIES
        )
        .into());
    }

    // EPUB fast path: if the archive carries `META-INF/container.xml`,
    // we can pull the cover from the OPF metadata directly. On any
    // failure (broken XML, missing manifest entry, etc.) we fall
    // through to the generic image scan so slightly malformed EPUBs
    // still produce a thumbnail. Non-EPUB ZIPs cost essentially
    // nothing here — `by_name` returns immediately when missing.
    if let Some((name, bytes)) = ebook::epub::try_extract_cover(&mut archive) {
        return Ok((name, bytes, ContentKind::Epub));
    }

    // FB2.zip fast path: many FB2s are distributed wrapped in a ZIP
    // (the `.fb2.zip` convention). If we find an `.fb2` entry inside
    // the ZIP, route through the FB2 cover-extraction logic instead
    // of the generic image scan. Falls through on failure.
    if let Some((name, bytes)) = try_extract_fb2_from_zip(&mut archive) {
        return Ok((name, bytes, ContentKind::Fb2));
    }

    // Collect image candidates that also fit under the per-entry size
    // cap. Oversized entries are skipped, not an error — maybe a
    // smaller sibling is usable.
    let candidates: Vec<String> = (0..archive.len())
        .filter_map(|i| {
            let f = archive.by_index(i).ok()?;
            if f.is_file()
                && settings.accepts_image_ext(f.name())
                && f.size() <= limits::MAX_ENTRY_SIZE
            {
                Some(f.name().to_string())
            } else {
                None
            }
        })
        .collect();

    let name = settings
        .pick_first_image(candidates)
        .ok_or("archive contains no (small enough) image files")?;

    let mut file = archive.by_name(&name)?;
    let mut buf = Vec::with_capacity(file.size() as usize);
    file.read_to_end(&mut buf)?;

    Ok((name, buf, ContentKind::Zip))
}

#[cfg(test)]
mod tests {
    use super::super::{read_first_image, tests::make_tiny_png};
    use crate::settings::Settings;
    use std::io::Cursor;

    // ---------------------------------------------------------------
    // detect_format: ZIP
    // ---------------------------------------------------------------

    #[test]
    fn detect_zip_local_header() {
        assert_eq!(
            super::super::detect_format(b"PK\x03\x04rest"),
            super::super::Format::Zip
        );
    }

    #[test]
    fn detect_zip_empty_archive() {
        assert_eq!(
            super::super::detect_format(b"PK\x05\x06rest"),
            super::super::Format::Zip
        );
    }

    #[test]
    fn detect_zip_spanned() {
        assert_eq!(
            super::super::detect_format(b"PK\x07\x08rest"),
            super::super::Format::Zip
        );
    }

    #[test]
    fn detect_zip_rejects_other_pk_variants() {
        assert_eq!(
            super::super::detect_format(b"PK\x01\x02xxxx"),
            super::super::Format::Unknown
        );
    }

    // ---------------------------------------------------------------
    // end-to-end: ZIP backend
    // ---------------------------------------------------------------

    /// Build an in-memory ZIP containing the named entries with the
    /// given (uncompressed) bodies. Returns a Cursor ready for
    /// `read_first_image`.
    fn build_zip(entries: &[(&str, &[u8])]) -> Cursor<Vec<u8>> {
        use zip::write::SimpleFileOptions;
        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(Cursor::new(&mut buf));
            let opts =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            for (name, body) in entries {
                w.start_file(*name, opts).unwrap();
                std::io::Write::write_all(&mut w, body).unwrap();
            }
            w.finish().unwrap();
        }
        Cursor::new(buf)
    }

    #[test]
    fn zip_picks_cover_when_present() {
        let zip = build_zip(&[
            ("page01.jpg", b"AAA"),
            ("page02.jpg", b"BBB"),
            ("cover.jpg", b"COVER"),
            ("readme.txt", b"ignore me"),
        ]);
        let (name, bytes) = read_first_image(zip, &Settings::default()).expect("read_first_image");
        assert_eq!(name, "cover.jpg");
        assert_eq!(bytes, b"COVER");
    }

    #[test]
    fn zip_natural_sort_picks_page1() {
        // No cover, but natural sort should put page1 ahead of page10.
        let zip = build_zip(&[
            ("page10.jpg", b"TEN"),
            ("page2.jpg", b"TWO"),
            ("page1.jpg", b"ONE"),
        ]);
        let (name, bytes) = read_first_image(zip, &Settings::default()).expect("read_first_image");
        assert_eq!(name, "page1.jpg");
        assert_eq!(bytes, b"ONE");
    }

    #[test]
    fn zip_skips_non_image_files() {
        let zip = build_zip(&[("notes.txt", b"text"), ("only.png", b"PNG_BYTES")]);
        let (name, _) = read_first_image(zip, &Settings::default()).expect("read_first_image");
        assert_eq!(name, "only.png");
    }

    #[test]
    fn zip_with_no_images_errors() {
        let zip = build_zip(&[("a.txt", b"text"), ("b.md", b"md")]);
        let result = read_first_image(zip, &Settings::default());
        assert!(
            result.is_err(),
            "expected error, got {:?}",
            result.map(|(n, _)| n)
        );
    }

    // ---------------------------------------------------------------
    // end-to-end: FB2 inside ZIP (`.fb2.zip` distribution variant)
    // ---------------------------------------------------------------

    #[test]
    fn fb2_inside_zip_is_extracted() {
        let png = make_tiny_png();
        let fb2 = super::super::tests::build_fb2("c.png", &png);
        let zip = build_zip(&[("book.fb2", &fb2)]);
        let (name, bytes) = read_first_image(zip, &Settings::default()).expect("fb2.zip read");
        assert_eq!(name, "c.png");
        let img = crate::decode::decode_with_limits(&name, &bytes).expect("decode fb2.zip cover");
        assert_eq!(img.width(), 2);
    }

    #[test]
    fn fb2_inside_zip_skips_unrelated_zip_images() {
        let png = make_tiny_png();
        let fb2 = super::super::tests::build_fb2("inside.png", &png);
        let zip = build_zip(&[("book.fb2", &fb2), ("zzz.png", b"not really a png")]);
        let (name, _) = read_first_image(zip, &Settings::default()).expect("fb2.zip read");
        assert_eq!(name, "inside.png");
    }

    #[test]
    fn zip_without_fb2_or_epub_still_uses_generic_scan() {
        let zip = build_zip(&[("page1.jpg", b"data")]);
        let (name, _) = read_first_image(zip, &Settings::default()).expect("plain ZIP read");
        assert_eq!(name, "page1.jpg");
    }

    // ---------------------------------------------------------------
    // ContentKind: the ZIP backend distinguishes plain ZIP / EPUB /
    // FB2-in-ZIP by content even though they share the `PK` magic.
    // This drives the identification overlay's colour and label.
    // ---------------------------------------------------------------

    #[test]
    fn plain_zip_reports_zip_kind() {
        use super::super::{ContentKind, read_first_image_with_kind};
        let zip = build_zip(&[("page1.jpg", b"data")]);
        let e = read_first_image_with_kind(zip, &Settings::default()).expect("plain ZIP read");
        assert_eq!(e.kind, ContentKind::Zip);
    }

    #[test]
    fn epub_reports_epub_kind() {
        use super::super::{ContentKind, read_first_image_with_kind};
        let png = make_tiny_png();
        let opf = r#"<?xml version="1.0"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf">
  <metadata/>
  <manifest>
    <item id="cov" href="img/cover.png" media-type="image/png" properties="cover-image"/>
  </manifest>
</package>"#;
        let epub = build_epub(
            standard_container_xml(),
            "OEBPS/content.opf",
            opf,
            &[("OEBPS/img/cover.png", &png)],
        );
        let e = read_first_image_with_kind(epub, &Settings::default()).expect("EPUB read");
        assert_eq!(e.kind, ContentKind::Epub);
    }

    #[test]
    fn fb2_in_zip_reports_fb2_kind() {
        use super::super::{ContentKind, read_first_image_with_kind};
        let png = make_tiny_png();
        let fb2 = super::super::tests::build_fb2("c.png", &png);
        let zip = build_zip(&[("book.fb2", &fb2)]);
        let e = read_first_image_with_kind(zip, &Settings::default()).expect("fb2.zip read");
        assert_eq!(e.kind, ContentKind::Fb2);
    }

    // ---------------------------------------------------------------
    // end-to-end: EPUB fast path through the ZIP backend
    // ---------------------------------------------------------------

    /// Build an in-memory EPUB ZIP.
    fn build_epub(
        container_xml: &str,
        opf_path: &str,
        opf_xml: &str,
        extras: &[(&str, &[u8])],
    ) -> Cursor<Vec<u8>> {
        use zip::write::SimpleFileOptions;
        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(Cursor::new(&mut buf));
            let opts =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

            w.start_file("mimetype", opts).unwrap();
            std::io::Write::write_all(&mut w, b"application/epub+zip").unwrap();

            w.start_file("META-INF/container.xml", opts).unwrap();
            std::io::Write::write_all(&mut w, container_xml.as_bytes()).unwrap();

            w.start_file(opf_path, opts).unwrap();
            std::io::Write::write_all(&mut w, opf_xml.as_bytes()).unwrap();

            for (name, body) in extras {
                w.start_file(*name, opts).unwrap();
                std::io::Write::write_all(&mut w, body).unwrap();
            }
            w.finish().unwrap();
        }
        Cursor::new(buf)
    }

    fn standard_container_xml() -> &'static str {
        r#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#
    }

    #[test]
    fn epub2_meta_cover_extracted() {
        let png = make_tiny_png();
        let opf = r#"<?xml version="1.0"?>
<package version="2.0" xmlns="http://www.idpf.org/2007/opf">
  <metadata>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="cover-image" href="images/front.png" media-type="image/png"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
</package>"#;
        let epub = build_epub(
            standard_container_xml(),
            "OEBPS/content.opf",
            opf,
            &[
                ("OEBPS/images/front.png", &png),
                ("OEBPS/images/zzz.png", b"NOT THIS ONE"),
            ],
        );
        let (name, bytes) = read_first_image(epub, &Settings::default()).expect("EPUB read");
        assert_eq!(name, "OEBPS/images/front.png");
        let img = crate::decode::decode_with_limits(&name, &bytes).expect("decode EPUB cover");
        assert_eq!(img.width(), 2);
        assert_eq!(img.height(), 2);
    }

    #[test]
    fn epub3_properties_cover_image_extracted() {
        let png = make_tiny_png();
        let opf = r#"<?xml version="1.0"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf">
  <metadata/>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="cov" href="img/cover.png" media-type="image/png" properties="cover-image"/>
  </manifest>
</package>"#;
        let epub = build_epub(
            standard_container_xml(),
            "OEBPS/content.opf",
            opf,
            &[("OEBPS/img/cover.png", &png)],
        );
        let (name, _) = read_first_image(epub, &Settings::default()).expect("EPUB read");
        assert_eq!(name, "OEBPS/img/cover.png");
    }

    #[test]
    fn epub_fallback_when_no_metadata() {
        let png = make_tiny_png();
        let opf = r#"<package>
  <metadata/>
  <manifest>
    <item id="ch1" href="ch1.xhtml"/>
  </manifest>
</package>"#;
        let epub = build_epub(
            standard_container_xml(),
            "OEBPS/content.opf",
            opf,
            &[("OEBPS/page1.png", &png), ("OEBPS/page2.png", &png)],
        );
        let (name, _) = read_first_image(epub, &Settings::default()).expect("EPUB read");
        assert!(
            name.ends_with("page1.png"),
            "expected page1.png fallback, got {name}"
        );
    }

    #[test]
    fn epub_fallback_when_opf_points_to_missing_image() {
        let png = make_tiny_png();
        let opf = r#"<package version="2.0">
  <metadata>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="cover-image" href="images/MISSING.jpg" media-type="image/jpeg"/>
  </manifest>
</package>"#;
        let epub = build_epub(
            standard_container_xml(),
            "OEBPS/content.opf",
            opf,
            &[("OEBPS/cover.png", &png)],
        );
        let (name, _) = read_first_image(epub, &Settings::default()).expect("EPUB read");
        assert!(name.ends_with("cover.png"));
    }

    #[test]
    fn epub_fallback_when_container_xml_is_garbage() {
        let png = make_tiny_png();
        let epub = build_epub(
            "this is not xml",
            "OEBPS/content.opf",
            "<package/>",
            &[("OEBPS/cover.png", &png)],
        );
        let (name, _) = read_first_image(epub, &Settings::default()).expect("EPUB read");
        assert!(name.ends_with("cover.png"));
    }

    #[test]
    fn epub_with_root_level_opf() {
        let png = make_tiny_png();
        let container =
            r#"<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>"#;
        let opf = r#"<package version="3.0">
  <manifest>
    <item id="c" href="cover.png" properties="cover-image"/>
  </manifest>
</package>"#;
        let epub = build_epub(container, "content.opf", opf, &[("cover.png", &png)]);
        let (name, _) = read_first_image(epub, &Settings::default()).expect("EPUB read");
        assert_eq!(name, "cover.png");
    }

    // ---------------------------------------------------------------
    // end-to-end: image-extension mask gating
    // ---------------------------------------------------------------

    #[test]
    fn mask_excludes_disabled_image_extension_from_candidates() {
        use crate::settings::{SUPPORTED_IMAGE_EXTS, Settings};

        let png = make_tiny_png();
        // Zip with one .jpg and one .png. The .jpg sorts before .png,
        // so with all-on mask the .jpg would be picked; with .jpg
        // disabled, the .png must be picked instead.
        let zip = build_zip(&[("a.jpg", &png), ("b.png", &png)]);

        let jpg_idx = SUPPORTED_IMAGE_EXTS
            .iter()
            .position(|&e| e == ".jpg")
            .unwrap();
        let settings = Settings {
            enabled_image_exts_mask: !(1u32 << jpg_idx)
                & crate::settings::default_enabled_image_exts_mask(),
            cover_mode: crate::settings::CoverMode::Ignore,
            ..Settings::default()
        };
        let (name, _) = read_first_image(zip, &settings).expect("jpg disabled");
        assert_eq!(name, "b.png");

        // Inverse: disable .png, .jpg should be picked.
        let zip = build_zip(&[("a.jpg", &png), ("b.png", &png)]);
        let png_idx = SUPPORTED_IMAGE_EXTS
            .iter()
            .position(|&e| e == ".png")
            .unwrap();
        let settings = Settings {
            enabled_image_exts_mask: !(1u32 << png_idx)
                & crate::settings::default_enabled_image_exts_mask(),
            cover_mode: crate::settings::CoverMode::Ignore,
            ..Settings::default()
        };
        let (name, _) = read_first_image(zip, &settings).expect("png disabled");
        assert_eq!(name, "a.jpg");
    }

    #[test]
    fn mask_of_zero_rejects_all_images_even_in_archive() {
        use crate::settings::Settings;

        let png = make_tiny_png();
        let zip = build_zip(&[("only.png", &png)]);
        let settings = Settings {
            enabled_image_exts_mask: 0,
            ..Settings::default()
        };
        let result = read_first_image(zip, &settings);
        assert!(result.is_err(), "zero mask must produce no-image error");
    }

    #[test]
    fn every_supported_extension_round_trips_through_zip_when_enabled_alone() {
        // For every supported extension, build a zip with only that
        // extension present, configure a mask that enables only that
        // extension, and verify it's picked.
        use crate::settings::{SUPPORTED_IMAGE_EXTS, Settings};

        let body = make_tiny_png();
        for (i, ext) in SUPPORTED_IMAGE_EXTS.iter().enumerate() {
            let entry = format!("file{ext}");
            let zip = build_zip(&[(&entry, &body)]);
            let settings = Settings {
                enabled_image_exts_mask: 1u32 << i,
                cover_mode: crate::settings::CoverMode::Ignore,
                ..Settings::default()
            };
            let (name, _) = read_first_image(zip, &settings)
                .unwrap_or_else(|e| panic!("ext {ext} with solo-enabled mask failed: {e}"));
            assert_eq!(name, entry, "should pick {entry} under solo mask");
        }
    }

    #[test]
    fn plain_zip_still_works_after_epub_fast_path() {
        let zip = build_zip(&[("page01.jpg", b"AAA"), ("page02.jpg", b"BBB")]);
        let (name, _) = read_first_image(zip, &Settings::default()).expect("plain ZIP read");
        assert_eq!(name, "page01.jpg");
    }

    // ---------------------------------------------------------------
    // Entry-count cap (`limits::MAX_ARCHIVE_ENTRIES`).
    // ---------------------------------------------------------------

    /// Builds a ZIP with `n` zero-byte non-image entries plus one
    /// trailing PNG, all stored (no compression). Used to drive the
    /// entry-count cap test without building a heavy archive.
    fn build_zip_with_n_dummies(n: usize) -> Cursor<Vec<u8>> {
        use zip::write::SimpleFileOptions;
        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(Cursor::new(&mut buf));
            let opts =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            for i in 0..n {
                let name = format!("f{i:07}.bin");
                w.start_file(&name, opts).unwrap();
                // empty body — keeps the archive tiny
            }
            w.start_file("cover.png", opts).unwrap();
            std::io::Write::write_all(&mut w, &make_tiny_png()).unwrap();
            w.finish().unwrap();
        }
        Cursor::new(buf)
    }

    #[test]
    fn zip_under_entry_cap_still_works() {
        // Sanity: an archive with a few entries goes through normally.
        let zip = build_zip_with_n_dummies(5);
        let (name, _) =
            read_first_image(zip, &Settings::default()).expect("small archive should pass");
        assert_eq!(name, "cover.png");
    }

    #[test]
    fn zip_over_entry_cap_is_rejected() {
        use crate::limits::MAX_ARCHIVE_ENTRIES;

        // One past the cap: must fail. Total archive size stays modest
        // (~5 MB of central directory for empty stored entries) so this
        // remains a normal-cost unit test even at the production cap.
        let zip = build_zip_with_n_dummies(MAX_ARCHIVE_ENTRIES);
        let err = read_first_image(zip, &Settings::default()).expect_err("must reject");
        let msg = err.to_string();
        assert!(
            msg.contains("too many entries"),
            "error should mention entry count, got: {msg}"
        );
    }
}
