export type ReaderFitMode = "fit" | "fill" | "fit-width" | "fit-height" | "original"
export type ReaderRotation = 0 | 90 | 180 | 270

export interface PresentationSize {
  width: number
  height: number
}

export interface ReaderPresentation {
  fitMode: ReaderFitMode
  manualScale: number
  rotation: ReaderRotation
}

export const DEFAULT_READER_PRESENTATION: ReaderPresentation = {
  fitMode: "fit",
  manualScale: 1,
  rotation: 0,
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
): PresentationSize | undefined {
  let width = 0
  let height = 0
  let found = false
  for (const page of pages) {
    if (!validSize(page)) continue
    const rotated = rotatePresentationSize(page, rotation)
    width += rotated.width
    height = Math.max(height, rotated.height)
    found = true
  }
  return found ? { width, height } : undefined
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
