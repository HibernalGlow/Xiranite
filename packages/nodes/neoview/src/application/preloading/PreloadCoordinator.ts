import { buildFrameSnapshot } from "../../domain/frame/frame-builder.js"
import type { FrameSnapshot } from "../../domain/frame/frame.js"
import type { ReaderPage } from "../../domain/page/page.js"
import type { ResourcePriority } from "../../ports/ResourceScheduler.js"

export type ReaderNavigationIntent = "initial" | "next" | "previous" | "go-to" | "layout"
export type ReaderPreloadDirection = "forward" | "backward"
export type ReaderPreloadTier = "near" | "ahead" | "background"

export interface ReaderPreloadCandidate {
  tier: ReaderPreloadTier
  priority: ResourcePriority
  anchorPageIndex: number
  pageIndexes: readonly number[]
  pageIds: readonly string[]
}

export interface ReaderPreloadPlan {
  generation: number
  frameGeneration: number
  direction: ReaderPreloadDirection
  directionConfidence: number
  currentPageIndexes: readonly number[]
  candidates: readonly ReaderPreloadCandidate[]
}

export interface ReaderPreloadCoordinatorOptions {
  nearFrames?: number
  aheadFrames?: number
  retainReverseFrame?: boolean
}

export class ReaderPreloadCoordinator {
  readonly #nearFrames: number
  readonly #aheadFrames: number
  readonly #retainReverseFrame: boolean
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
  }

  update(frame: FrameSnapshot, intent: ReaderNavigationIntent): ReaderPreloadPlan {
    const previousAnchor = this.#lastAnchorPageIndex
    const direction = inferDirection(intent, frame.anchorPageIndex, previousAnchor, this.#direction)
    const confidence = directionConfidence(intent, frame.anchorPageIndex, previousAnchor)
    this.#direction = direction
    this.#lastAnchorPageIndex = frame.anchorPageIndex
    this.#generation += 1
    this.#plan = {
      generation: this.#generation,
      frameGeneration: frame.generation,
      direction,
      directionConfidence: confidence,
      currentPageIndexes: frame.pages.map((page) => page.pageIndex),
      candidates: buildCandidates(this.pages, frame, direction, this.#nearFrames, this.#aheadFrames, this.#retainReverseFrame),
    }
    return this.#plan
  }

  snapshot(): ReaderPreloadPlan | undefined {
    return this.#plan
  }
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
