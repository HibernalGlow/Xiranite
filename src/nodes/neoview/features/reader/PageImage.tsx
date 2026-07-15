import type { ReaderPageDto } from "../../adapters/reader-http-client"

export interface PageImageProps {
  page: ReaderPageDto
}

export function PageImage({ page }: PageImageProps) {
  return (
    <img
      src={page.assetUrl}
      alt={page.name}
      draggable={false}
      decoding="async"
      fetchPriority="high"
      className="max-h-full min-h-0 max-w-full select-none object-contain"
    />
  )
}
