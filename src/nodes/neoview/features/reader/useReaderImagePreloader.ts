import { useCallback, useEffect, useRef } from "react"

import type { ReaderPageDto } from "../../adapters/reader-http-client"
import { readerPreloadStatusStore } from "./ReaderPreloadStatusStore"

const MAX_PREDECODED_IMAGES = 4
export const READER_PREFETCH_READY_MARK = "neoview-reader-prefetch-ready"

interface PreloadedImage {
  image: HTMLImageElement
  pageIndex: number
}

export function useReaderImagePreloader(sessionId?: string): (pages: readonly ReaderPageDto[]) => void {
  const imagesRef = useRef(new Map<string, PreloadedImage>())

  useEffect(() => {
    const images = imagesRef.current
    return () => {
      for (const entry of images.values()) entry.image.src = ""
      images.clear()
      if (sessionId) readerPreloadStatusStore.clear(sessionId)
    }
  }, [sessionId])

  return useCallback((pages: readonly ReaderPageDto[]) => {
    if (typeof Image === "undefined" || !sessionId) return
    const images = imagesRef.current
    for (const page of pages) {
      if (page.mediaKind !== "image" || images.has(page.assetUrl)) continue
      const image = new Image()
      image.decoding = "async"
      image.fetchPriority = "low"
      image.src = page.assetUrl
      images.set(page.assetUrl, { image, pageIndex: page.index })
      readerPreloadStatusStore.begin(sessionId, page.index)
      void image.decode().then(() => {
        if (images.get(page.assetUrl)?.image !== image) return
        readerPreloadStatusStore.ready(sessionId, page.index)
        performance.mark(READER_PREFETCH_READY_MARK, { detail: page.index })
      }).catch(() => {
        if (images.get(page.assetUrl)?.image === image) readerPreloadStatusStore.fail(sessionId, page.index)
      })
    }
    while (images.size > MAX_PREDECODED_IMAGES) {
      const oldestUrl = images.keys().next().value
      if (!oldestUrl) break
      const oldest = images.get(oldestUrl)
      images.delete(oldestUrl)
      if (oldest) {
        oldest.image.src = ""
        readerPreloadStatusStore.evict(sessionId, oldest.pageIndex)
      }
    }
  }, [sessionId])
}
