import { useState } from "react"

import type { ReaderPageDto } from "../../adapters/reader-http-client"
import { readerPresentationUrl, type ReaderViewport } from "./presentation-url"

export interface PageImageProps {
  page: ReaderPageDto
  viewport: ReaderViewport
  visiblePageCount: number
}

export function PageImage({ page, viewport, visiblePageCount }: PageImageProps) {
  const preferredUrl = readerPresentationUrl(page, viewport, visiblePageCount)
  const [failedTransform, setFailedTransform] = useState<string | undefined>(undefined)
  const sourceUrl = failedTransform === preferredUrl ? page.assetUrl : preferredUrl
  return (
    <img
      src={sourceUrl}
      alt={page.name}
      draggable={false}
      decoding="async"
      fetchPriority="high"
      onError={() => {
        if (sourceUrl !== page.assetUrl) setFailedTransform(sourceUrl)
      }}
      className="max-h-full min-h-0 max-w-full select-none object-contain"
    />
  )
}
