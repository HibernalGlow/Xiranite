export type ReaderFitMode = "fit" | "fill" | "fit-width" | "fit-height" | "original" | "fit-left" | "fit-right"
export type ReaderRotation = 0 | 90 | 180 | 270
export type ReaderOrientation = "horizontal" | "vertical"
export type ReaderAutoRotation = "none" | "left" | "right" | "horizontal-left" | "horizontal-right" | "forced-left" | "forced-right"
export type ReaderWidePageStretch = "none" | "uniform-height" | "uniform-width"

export interface PresentationSize {
  width: number
  height: number
}

export interface ReaderPresentation {
  fitMode: ReaderFitMode
  manualScale: number
  rotation: ReaderRotation
  orientation: ReaderOrientation
  autoRotation: ReaderAutoRotation
  widePageStretch: ReaderWidePageStretch
}

export const DEFAULT_READER_PRESENTATION: ReaderPresentation = {
  fitMode: "fit",
  manualScale: 1,
  rotation: 0,
  orientation: "horizontal",
  autoRotation: "none",
  widePageStretch: "uniform-height",
}

export function calculateReaderScale(
  fitMode: ReaderFitMode,
  content: PresentationSize,
  viewport: PresentationSize,
  manualScale = 1,
): number {
  if (!validSize(content) || !validSize(viewport)) return normalizeReaderManualScale(manualScale)
  const widthScale = viewport.width / content.width
  const heightScale = viewport.height / content.height
  const modeScale = fitMode === "fill"
    ? Math.max(widthScale, heightScale)
    : fitMode === "fit-width"
      ? widthScale
      : fitMode === "fit-height"
        ? heightScale
        : fitMode === "original"
          ? 1
          : Math.min(widthScale, heightScale)
  return modeScale * normalizeReaderManualScale(manualScale)
}

export function calculateReaderFrameSize(
  pages: readonly PresentationSize[],
  rotation: ReaderRotation,
  orientation: ReaderOrientation = "horizontal",
  autoRotation: ReaderAutoRotation = "none",
  widePageStretch: ReaderWidePageStretch = "none",
): PresentationSize | undefined {
  const rotatedPages = pages.filter(validSize).map((page) => rotatePresentationSize(page, effectiveReaderRotation(rotation, autoRotation, page)))
  const stretchScales = calculateReaderPageStretchScales(rotatedPages, widePageStretch)
  let width = 0
  let height = 0
  let found = false
  for (let index = 0; index < rotatedPages.length; index += 1) {
    const page = rotatedPages[index]!
    const stretch = stretchScales[index] ?? 1
    const rotated = { width: page.width * stretch, height: page.height * stretch }
    if (orientation === "vertical") {
      width = Math.max(width, rotated.width)
      height += rotated.height
    } else {
      width += rotated.width
      height = Math.max(height, rotated.height)
    }
    found = true
  }
  return found ? { width, height } : undefined
}

export function calculateReaderPageStretchScales(
  pages: readonly PresentationSize[],
  mode: ReaderWidePageStretch,
): readonly number[] {
  if (pages.length < 2 || mode === "none") return pages.map(() => 1)
  if (mode === "uniform-height") {
    let maximumHeight = 0
    for (const page of pages) maximumHeight = Math.max(maximumHeight, page.height)
    return maximumHeight > 0 ? pages.map((page) => maximumHeight / page.height) : pages.map(() => 1)
  }
  let totalWidth = 0
  for (const page of pages) totalWidth += page.width
  const averageWidth = totalWidth / pages.length
  return averageWidth > 0 ? pages.map((page) => averageWidth / page.width) : pages.map(() => 1)
}

export function effectiveReaderRotation(
  manualRotation: ReaderRotation,
  autoRotation: ReaderAutoRotation,
  page: PresentationSize,
): ReaderRotation {
  const portrait = page.height > page.width
  const delta = autoRotation === "forced-left"
    || (autoRotation === "left" && portrait)
    || (autoRotation === "horizontal-left" && !portrait)
    ? -90
    : autoRotation === "forced-right"
      || (autoRotation === "right" && portrait)
      || (autoRotation === "horizontal-right" && !portrait)
      ? 90
      : 0
  return normalizeReaderRotation(manualRotation + delta)
}

export function rotatePresentationSize(size: PresentationSize, rotation: ReaderRotation): PresentationSize {
  return rotation === 90 || rotation === 270
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height }
}

export function rotateReaderPresentation(rotation: ReaderRotation, quarterTurns: number): ReaderRotation {
  return normalizeReaderRotation(rotation + quarterTurns * 90)
}

export function normalizeReaderRotation(rotation: number): ReaderRotation {
  const normalized = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360
  return normalized as ReaderRotation
}

export function normalizeReaderManualScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(8, Math.max(0.1, Math.round(scale * 100) / 100))
}

export function stepReaderManualScale(scale: number, direction: -1 | 1): number {
  return normalizeReaderManualScale(scale * (direction > 0 ? 1.1 : 1 / 1.1))
}

function validSize(size: PresentationSize): boolean {
  return Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
}
