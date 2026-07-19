import {
  DEFAULT_READER_IMAGE_TRIM,
  normalizeReaderImageTrim,
  projectReaderImageTrimPatch,
  type ReaderImageTrimPatch,
  type ReaderImageTrimSettings,
} from "@xiranite/node-neoview/image-trim"
import type {
  ReaderImageTrimDetector,
  ReaderImageTrimMargins,
} from "./ReaderImageTrimDetector"

export type ReaderImageTrimDetectionOutcome =
  | { status: "applied"; margins: ReaderImageTrimMargins }
  | { status: "no-border" }
  | { status: "unavailable" }
  | { status: "cancelled" }

export interface ReaderImageTrimPort {
  subscribe(listener: () => void): () => void
  getSnapshot(): ReaderImageTrimSettings | undefined
  hydrate(settings: ReaderImageTrimSettings): void
  preview(patch: ReaderImageTrimPatch): void
  commit(): Promise<void>
  update(patch: ReaderImageTrimPatch): Promise<void>
  reset(): Promise<void>
  registerImage(identity: string, element: HTMLImageElement): () => void
  autoDetect(): Promise<ReaderImageTrimDetectionOutcome>
  presetBlack(): Promise<ReaderImageTrimDetectionOutcome>
  presetWhite(): Promise<ReaderImageTrimDetectionOutcome>
  cancelDetection(): void
  dispose(): void
}

export interface ReaderImageTrimStoreOptions {
  persist(settings: ReaderImageTrimSettings, reset: boolean, signal: AbortSignal): Promise<ReaderImageTrimSettings>
  detect?: ReaderImageTrimDetector
  onError?(cause: unknown): void
}

export function createReaderImageTrimStore(options: ReaderImageTrimStoreOptions): ReaderImageTrimPort {
  let snapshot: ReaderImageTrimSettings | undefined
  let confirmed = DEFAULT_READER_IMAGE_TRIM
  let revision = 0
  let requestedRevision = 0
  let resetRequested = false
  let write: Promise<void> | undefined
  let disposed = false
  let touched = false
  let imageSequence = 0
  let imageGeneration = 0
  let activeImage: RegisteredImage | undefined
  let detectionController: AbortController | undefined
  const registeredImages = new Map<symbol, RegisteredImage>()
  const listeners = new Set<() => void>()
  const controller = new AbortController()

  const cancelDetection = () => {
    detectionController?.abort()
    detectionController = undefined
  }
  const selectActiveImage = () => {
    let next: RegisteredImage | undefined
    for (const registered of registeredImages.values()) {
      if (!next || registered.sequence > next.sequence) next = registered
    }
    if (next?.identity === activeImage?.identity && next?.element === activeImage?.element) return
    activeImage = next
    imageGeneration += 1
    cancelDetection()
  }

  const publish = (next: ReaderImageTrimSettings) => {
    if (disposed) return
    snapshot = next
    for (const listener of listeners) listener()
  }
  const preview = (patch: ReaderImageTrimPatch) => {
    if (disposed) return
    touched = true
    revision += 1
    publish(projectReaderImageTrimPatch(snapshot ?? DEFAULT_READER_IMAGE_TRIM, patch))
  }
  const commit = (reset = false): Promise<void> => {
    if (disposed || !snapshot) return Promise.resolve()
    requestedRevision = revision
    resetRequested ||= reset
    write ??= drain().finally(() => { write = undefined })
    return write
  }
  async function drain(): Promise<void> {
    while (!disposed) {
      const targetRevision = requestedRevision
      const target = snapshot ?? DEFAULT_READER_IMAGE_TRIM
      const reset = resetRequested
      resetRequested = false
      if (!reset && sameSettings(target, confirmed)) return
      try {
        const updated = normalizeReaderImageTrim(await options.persist(target, reset, controller.signal))
        if (disposed) return
        confirmed = updated
        if (revision === targetRevision) publish(updated)
      } catch (cause) {
        if (controller.signal.aborted) return
        if (revision === targetRevision) publish(confirmed)
        options.onError?.(cause)
        throw cause
      }
      if (requestedRevision === targetRevision) return
    }
  }

  async function detect(target?: "black" | "white"): Promise<ReaderImageTrimDetectionOutcome> {
    if (disposed) return { status: "cancelled" }
    const registered = activeImage
    if (!registered || !registered.element.complete || registered.element.naturalWidth <= 0) return { status: "unavailable" }

    cancelDetection()
    const detection = new AbortController()
    detectionController = detection
    const generation = imageGeneration
    const settings = snapshot ?? DEFAULT_READER_IMAGE_TRIM
    try {
      const run = options.detect ?? (await import("./ReaderImageTrimDetector")).detectReaderImageTrim
      if (detection.signal.aborted) return { status: "cancelled" }
      const margins = await run(registered.element, {
        threshold: target ? 40 : settings.autoTrimThreshold,
        target: target ?? settings.autoTrimTarget,
        signal: detection.signal,
      })
      if (
        detection.signal.aborted
        || generation !== imageGeneration
        || activeImage?.identity !== registered.identity
        || activeImage.element !== registered.element
      ) return { status: "cancelled" }
      if (!hasMargins(margins)) return { status: "no-border" }
      preview({ enabled: true, ...margins })
      await commit()
      return { status: "applied", margins }
    } catch (cause) {
      if (detection.signal.aborted || isAbortError(cause)) return { status: "cancelled" }
      throw cause
    } finally {
      if (detectionController === detection) detectionController = undefined
    }
  }

  return {
    subscribe(listener) {
      if (disposed) return () => undefined
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    hydrate(settings) {
      if (disposed || touched) return
      confirmed = normalizeReaderImageTrim(settings)
      publish(confirmed)
    },
    preview,
    commit,
    async update(patch) {
      preview(patch)
      await commit()
    },
    async reset() {
      if (disposed) return
      touched = true
      revision += 1
      publish({ ...DEFAULT_READER_IMAGE_TRIM })
      await commit(true)
    },
    registerImage(identity, element) {
      if (disposed) return () => undefined
      const token = Symbol(identity)
      registeredImages.set(token, { identity, element, sequence: ++imageSequence })
      selectActiveImage()
      return () => {
        if (!registeredImages.delete(token)) return
        selectActiveImage()
      }
    },
    autoDetect: () => detect(),
    presetBlack: () => detect("black"),
    presetWhite: () => detect("white"),
    cancelDetection,
    dispose() {
      if (disposed) return
      disposed = true
      cancelDetection()
      controller.abort()
      snapshot = undefined
      activeImage = undefined
      registeredImages.clear()
      listeners.clear()
    },
  }
}

interface RegisteredImage {
  identity: string
  element: HTMLImageElement
  sequence: number
}

function hasMargins(margins: ReaderImageTrimMargins): boolean {
  return margins.top > 0 || margins.bottom > 0 || margins.left > 0 || margins.right > 0
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException
    ? cause.name === "AbortError"
    : cause instanceof Error && cause.name === "AbortError"
}

function sameSettings(left: ReaderImageTrimSettings, right: ReaderImageTrimSettings): boolean {
  return left.enabled === right.enabled
    && left.top === right.top
    && left.bottom === right.bottom
    && left.left === right.left
    && left.right === right.right
    && left.linkVertical === right.linkVertical
    && left.linkHorizontal === right.linkHorizontal
    && left.autoTrimThreshold === right.autoTrimThreshold
    && left.autoTrimTarget === right.autoTrimTarget
}
