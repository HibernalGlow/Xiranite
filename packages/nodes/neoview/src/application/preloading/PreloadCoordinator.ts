import { buildFrameSnapshot } from "../../domain/frame/frame-builder.js"
import type { FrameSnapshot } from "../../domain/frame/frame.js"
import type { ReaderPage } from "../../domain/page/page.js"
import type { ResourcePriority } from "../../ports/ResourceScheduler.js"
import type {
  ReaderPreloadAdmission,
  ReaderPreloadCandidate,
  ReaderPreloadContext,
  ReaderPreloadDirection,
  ReaderPreloadMode,
  ReaderPreloadPlan,
  ReaderPreloadTier,
} from "../../ports/ReaderPreload.js"

export type ReaderNavigationIntent = "initial" | "next" | "previous" | "go-to" | "layout"
export type {
  ReaderPreloadAdmission,
  ReaderPreloadCandidate,
  ReaderPreloadContext,
  ReaderPreloadDirection,
  ReaderPreloadMode,
  ReaderPreloadPlan,
  ReaderPreloadTier,
} from "../../ports/ReaderPreload.js"

export interface ReaderPreloadCoordinatorOptions {
  nearFrames?: number
  aheadFrames?: number
  retainReverseFrame?: boolean
  maxSpeculativeQueueWaitMs?: number
}

export class ReaderPreloadCoordinator {
  readonly #nearFrames: number
  readonly #aheadFrames: number
  readonly #retainReverseFrame: boolean
  readonly #maxSpeculativeQueueWaitMs: number
  #generation = 0
  #lastAnchorPageIndex?: number
  #direction: ReaderPreloadDirection = "forward"
  #plan?: ReaderPreloadPlan

  constructor(
    private readonly pages: readonly ReaderPage[],
    options: ReaderPreloadCoordinatorOptions = {},
  ) {
    this.#nearFrames = bounded(options.nearFrames ?? 1, "nearFrames", 0, 4)
    this.#aheadFrames = bounded(options.aheadFrames ?? 2, "aheadFrames", 0, 8)
    this.#retainReverseFrame = options.retainReverseFrame ?? true
    this.#maxSpeculativeQueueWaitMs = bounded(options.maxSpeculativeQueueWaitMs ?? 100, "maxSpeculativeQueueWaitMs", 0, 60_000)
  }

  update(frame: FrameSnapshot, intent: ReaderNavigationIntent, context: ReaderPreloadContext = {}): ReaderPreloadPlan {
    const normalized = normalizeContext(context)
    const previousAnchor = this.#lastAnchorPageIndex
    const inferredDirection = inferDirection(intent, frame.anchorPageIndex, previousAnchor, this.#direction)
    const direction = viewportDirection(normalized, inferredDirection)
    const confidence = viewportConfidence(normalized, directionConfidence(intent, frame.anchorPageIndex, previousAnchor))
    const budget = preloadBudget(normalized, this.#nearFrames, this.#aheadFrames, this.#retainReverseFrame, this.#maxSpeculativeQueueWaitMs)
    this.#direction = direction
    this.#lastAnchorPageIndex = frame.anchorPageIndex
    this.#generation += 1
    this.#plan = {
      generation: this.#generation,
      frameGeneration: frame.generation,
      direction,
      directionConfidence: confidence,
      mode: normalized.mode,
      admission: budget.admission,
      velocityPagesPerSecond: normalized.velocityPagesPerSecond,
      stableForMs: normalized.stableForMs,
      focused: normalized.focused,
      queueWaitMs: normalized.queueWaitMs,
      memoryPressure: normalized.memoryPressure,
      currentPageIndexes: frame.pages.map((page) => page.pageIndex),
      candidates: buildCandidates(this.pages, frame, direction, budget.nearFrames, budget.aheadFrames, budget.retainReverseFrame),
    }
    return this.#plan
  }

  snapshot(): ReaderPreloadPlan | undefined {
    return this.#plan
  }
}

interface NormalizedPreloadContext {
  mode: ReaderPreloadMode
  velocityPagesPerSecond: number
  stableForMs: number
  focused: boolean
  queueWaitMs: number
  memoryPressure: "normal" | "elevated" | "critical"
}

function normalizeContext(context: ReaderPreloadContext): NormalizedPreloadContext {
  const mode = context.mode ?? "paged"
  if (mode !== "paged" && mode !== "continuous" && mode !== "scrub") throw new TypeError(`Invalid preload mode: ${mode}`)
  const velocityPagesPerSecond = context.velocityPagesPerSecond ?? 0
  if (!Number.isFinite(velocityPagesPerSecond) || Math.abs(velocityPagesPerSecond) > 10_000) {
    throw new RangeError("velocityPagesPerSecond must be finite and at most 10000 in magnitude.")
  }
  const stableForMs = context.stableForMs ?? Number.MAX_SAFE_INTEGER
  if (!Number.isSafeInteger(stableForMs) || stableForMs < 0) throw new RangeError("stableForMs must be a non-negative safe integer.")
  const queueWaitMs = context.queueWaitMs ?? 0
  if (!Number.isFinite(queueWaitMs) || queueWaitMs < 0 || queueWaitMs > 60_000) throw new RangeError("queueWaitMs must be finite from 0 to 60000.")
  const memoryPressure = context.memoryPressure ?? "normal"
  if (memoryPressure !== "normal" && memoryPressure !== "elevated" && memoryPressure !== "critical") {
    throw new TypeError(`Invalid memoryPressure: ${memoryPressure}`)
  }
  return { mode, velocityPagesPerSecond, stableForMs, focused: context.focused ?? true, queueWaitMs, memoryPressure }
}

function viewportDirection(context: NormalizedPreloadContext, fallback: ReaderPreloadDirection): ReaderPreloadDirection {
  if (context.mode !== "continuous" || Math.abs(context.velocityPagesPerSecond) < 0.05) return fallback
  return context.velocityPagesPerSecond > 0 ? "forward" : "backward"
}

function viewportConfidence(context: NormalizedPreloadContext, fallback: number): number {
  if (context.mode !== "continuous" || Math.abs(context.velocityPagesPerSecond) < 0.05) return fallback
  return Math.min(1, 0.5 + Math.abs(context.velocityPagesPerSecond) / 8)
}

function preloadBudget(
  context: NormalizedPreloadContext,
  nearFrames: number,
  aheadFrames: number,
  retainReverseFrame: boolean,
  maxSpeculativeQueueWaitMs: number,
): { admission: ReaderPreloadAdmission; nearFrames: number; aheadFrames: number; retainReverseFrame: boolean } {
  const speed = Math.abs(context.velocityPagesPerSecond)
  if (context.memoryPressure !== "normal" || context.queueWaitMs > maxSpeculativeQueueWaitMs
    || !context.focused || context.mode === "scrub" || context.stableForMs < 120 || (context.mode === "continuous" && speed >= 4)) {
    return { admission: "paused", nearFrames: 0, aheadFrames: 0, retainReverseFrame: false }
  }
  if (context.mode === "continuous" && speed >= 1.5) {
    return { admission: "reduced", nearFrames: Math.min(nearFrames, 1), aheadFrames: Math.min(aheadFrames, 1), retainReverseFrame: false }
  }
  return { admission: "normal", nearFrames, aheadFrames, retainReverseFrame: retainReverseFrame && context.stableForMs >= 150 }
}

function buildCandidates(
  pages: readonly ReaderPage[],
  current: FrameSnapshot,
  direction: ReaderPreloadDirection,
  nearFrames: number,
  aheadFrames: number,
  retainReverseFrame: boolean,
): ReaderPreloadCandidate[] {
  if (!pages.length) return []
  const candidates: ReaderPreloadCandidate[] = []
  const selected = new Set(current.pages.map((page) => page.pageIndex))
  let cursor = current
  for (let offset = 0; offset < nearFrames + aheadFrames; offset += 1) {
    const next = adjacentFrame(pages, cursor, direction)
    if (!next || next.pages.every((page) => selected.has(page.pageIndex))) break
    const tier: ReaderPreloadTier = offset < nearFrames ? "near" : "ahead"
    candidates.push(candidateOf(next, tier, tier === "near" ? "view" : "ahead"))
    for (const page of next.pages) selected.add(page.pageIndex)
    cursor = next
  }
  if (retainReverseFrame) {
    const reverse = adjacentFrame(pages, current, direction === "forward" ? "backward" : "forward")
    if (reverse && reverse.pages.some((page) => !selected.has(page.pageIndex))) {
      candidates.push(candidateOf(reverse, "background", "background"))
    }
  }
  return candidates
}

function adjacentFrame(
  pages: readonly ReaderPage[],
  frame: FrameSnapshot,
  direction: ReaderPreloadDirection,
): FrameSnapshot | undefined {
  if (direction === "forward" && frame.atEnd) return undefined
  if (direction === "backward" && frame.atStart) return undefined
  const anchorPageIndex = direction === "forward"
    ? Math.max(...frame.pages.map((page) => page.pageIndex)) + 1
    : frame.anchorPageIndex - Math.max(frame.pages.length, 1)
  const adjacent = buildFrameSnapshot({
    pages,
    anchorPageIndex,
    generation: frame.generation,
    direction: frame.direction,
    layout: frame.layout,
  })
  return adjacent.pages.length ? adjacent : undefined
}

function candidateOf(frame: FrameSnapshot, tier: ReaderPreloadTier, priority: ResourcePriority): ReaderPreloadCandidate {
  return {
    tier,
    priority,
    anchorPageIndex: frame.anchorPageIndex,
    pageIndexes: frame.pages.map((page) => page.pageIndex),
    pageIds: frame.pages.map((page) => page.pageId),
  }
}

function inferDirection(
  intent: ReaderNavigationIntent,
  anchor: number,
  previousAnchor: number | undefined,
  fallback: ReaderPreloadDirection,
): ReaderPreloadDirection {
  if (intent === "next") return "forward"
  if (intent === "previous") return "backward"
  if (previousAnchor !== undefined && anchor !== previousAnchor) return anchor > previousAnchor ? "forward" : "backward"
  return intent === "initial" ? "forward" : fallback
}

function directionConfidence(intent: ReaderNavigationIntent, anchor: number, previousAnchor: number | undefined): number {
  if (intent === "next" || intent === "previous") return 1
  if (intent === "go-to" && previousAnchor !== undefined && anchor !== previousAnchor) return 0.75
  if (intent === "layout") return 0.5
  return 0.35
}

function bounded(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`)
  }
  return value
}
