import type { PageContent } from "../domain/page/page-content.js"
import type { PageDimensions } from "../domain/page/page.js"
import type { ProbedImageFormat } from "../domain/image/image-dimensions.js"

export type { ProbedImageFormat } from "../domain/image/image-dimensions.js"

export interface ProbedImageMetadata {
  format: ProbedImageFormat
  dimensions: PageDimensions
  bytesRead: number
  orientation?: number
}

export interface ImageMetadataProbe {
  probe(content: PageContent, mimeType?: string, signal?: AbortSignal): Promise<ProbedImageMetadata | undefined>
}
