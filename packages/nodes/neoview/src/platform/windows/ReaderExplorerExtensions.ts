import type { NeoviewMediaConfig } from "../../application/config/ReaderRuntimeConfig.js"
import { DEFAULT_READER_IMAGE_FORMATS, DEFAULT_READER_VIDEO_FORMATS } from "../../domain/page/media.js"
import { PLATFORM_READER_ARCHIVE_BOOK_EXTENSIONS } from "../filesystem/PlatformReaderBookCandidate.js"

type ReaderExplorerMediaFormats = Pick<NeoviewMediaConfig, "supportedImageFormats" | "videoFormats">

const DEFAULT_MEDIA_FORMATS: ReaderExplorerMediaFormats = {
  supportedImageFormats: DEFAULT_READER_IMAGE_FORMATS,
  videoFormats: DEFAULT_READER_VIDEO_FORMATS,
}

/**
 * Explorer must advertise exactly the file types Reader can open. Directories
 * are registered separately and do not depend on this list.
 */
export function readerExplorerFileExtensions(media: ReaderExplorerMediaFormats = DEFAULT_MEDIA_FORMATS): readonly string[] {
  return Object.freeze([...new Set([
    ...media.supportedImageFormats,
    ...media.videoFormats,
    ...PLATFORM_READER_ARCHIVE_BOOK_EXTENSIONS,
  ])])
}
