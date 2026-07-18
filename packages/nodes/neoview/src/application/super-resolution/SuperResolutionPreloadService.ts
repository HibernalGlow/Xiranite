import pMap from "p-map"
import { setTimeout as delay } from "node:timers/promises"

import type { ReaderPage } from "../../domain/page/page.js"
import type { SuperResolutionPreferences } from "../../domain/super-resolution/super-resolution-preferences.js"
import type { ResourcePriority } from "../../ports/ResourceScheduler.js"
import type { ReaderPreloadPlan } from "../preloading/PreloadCoordinator.js"
import type {
  SuperResolutionPageInput,
  SuperResolutionPageResult,
} from "./SuperResolutionPageService.js"
import type {
  SuperResolutionArtifactDescriptor,
  SuperResolutionArtifactPageInput,
  SuperResolutionArtifactRunDecision,
  SuperResolutionArtifactWarmResult,
} from "./SuperResolutionArtifactPageService.js"

export interface SuperResolutionPreloadPageRunner {
  run(input: SuperResolutionPageInput, context?: { signal?: AbortSignal }): Promise<SuperResolutionPageResult>
}

export interface SuperResolutionArtifactDestinationContext {
  contextId: string
  generation: number
  trigger: "preload"
  signal: AbortSignal
}

export type SuperResolutionArtifactDestinationResolver = (
  page: ReaderPage,
  context: SuperResolutionArtifactDestinationContext,
) => string | Promise<string>

export type SuperResolutionArtifactDescriptorResolver = (
  page: ReaderPage,
  context: SuperResolutionArtifactDestinationContext & { decision: SuperResolutionArtifactRunDecision },
) => SuperResolutionArtifactDescriptor | Promise<SuperResolutionArtifactDescriptor>

interface SuperResolutionArtifactPageWarmer {
  warm(input: SuperResolutionArtifactPageInput, context?: { signal?: AbortSignal }): Promise<SuperResolutionArtifactWarmResult>
}

export interface SuperResolutionPreloadPlanInput {
  contextId: string
  plan: ReaderPreloadPlan
  pages: readonly ReaderPage[]
  bookPath: string
  destinationFor?: SuperResolutionArtifactDestinationResolver
  artifactFor?: SuperResolutionArtifactDescriptorResolver
  metadataFor?: (page: ReaderPage) => Readonly<Record<string, unknown>> | undefined
  maxMaterializationBytes?: number
  signal?: AbortSignal
  onPageSettled?: (outcome: SuperResolutionPreloadPageOutcome) => void
}

export interface SuperResolutionProgressiveInput {
  contextId: string
  generation: number
  currentPageIndex: number
  pages: readonly ReaderPage[]
  bookPath: string
  destinationFor?: SuperResolutionArtifactDestinationResolver
  artifactFor?: SuperResolutionArtifactDescriptorResolver
  metadataFor?: (page: ReaderPage) => Readonly<Record<string, unknown>> | undefined
  maxMaterializationBytes?: number
  signal?: AbortSignal
  onPageSettled?: (outcome: SuperResolutionPreloadPageOutcome) => void
}

export type SuperResolutionPreloadPageOutcome =
  | {
      pageId: string
      pageIndex: number
      status: "settled"
      output: SuperResolutionPageResult | SuperResolutionArtifactWarmResult
    }
  | {
      pageId: string
      pageIndex: number
      status: "failed" | "cancelled"
      error: unknown
    }

export interface SuperResolutionPreloadBatchResult {
  contextId: string
  generation: number
  mode: "nearby" | "progressive"
  reason: "completed" | "disabled" | "empty"
  planned: number
  settled: number
  failed: number
  cancelled: number
  outcomes: readonly SuperResolutionPreloadPageOutcome[]
}

interface ScheduledPage {
  page: ReaderPage
  priority: ResourcePriority
}

interface ActiveBatch {
  generation: number
  controller: AbortController
  promise: Promise<SuperResolutionPreloadBatchResult>
}

const DEFAULT_PRELOAD_PAGES = 3
const DEFAULT_BACKGROUND_CONCURRENCY = 2
const DEFAULT_PROGRESSIVE_DWELL_MS = 3_000
const DEFAULT_PROGRESSIVE_MAX_PAGES = 20

export class SuperResolutionPreloadService implements AsyncDisposable {
  readonly #preloadPages: number
  readonly #concurrency: number
  readonly #progressiveEnabled: boolean
  readonly #progressiveDwellMs: number
  readonly #progressiveMaxPages: number
  readonly #automaticEnabled: boolean
  readonly #preloadEnabled: boolean
  readonly #active = new Map<string, ActiveBatch>()
  #disposed = false

  constructor(
    private readonly pages: SuperResolutionPreloadPageRunner,
    preferences: SuperResolutionPreferences,
    private readonly artifactPages?: SuperResolutionArtifactPageWarmer,
  ) {
    this.#preloadPages = boundedInteger(preferences.preloadPages ?? DEFAULT_PRELOAD_PAGES, "preload pages", 0, 1_000)
    this.#concurrency = boundedInteger(
      preferences.backgroundConcurrency ?? DEFAULT_BACKGROUND_CONCURRENCY,
      "background concurrency",
      1,
      32,
    )
    this.#progressiveEnabled = preferences.progressiveEnabled === true
    this.#progressiveDwellMs = boundedInteger(
      preferences.progressiveDwellTimeMs ?? DEFAULT_PROGRESSIVE_DWELL_MS,
      "progressive dwell time",
      0,
      3_600_000,
    )
    this.#progressiveMaxPages = boundedInteger(
      preferences.progressiveMaxPages ?? DEFAULT_PROGRESSIVE_MAX_PAGES,
      "progressive max pages",
      0,
      10_000,
    )
    this.#automaticEnabled = preferences.globalUpscaleEnabled !== false && preferences.autoUpscaleEnabled === true
    this.#preloadEnabled = preferences.preUpscaleEnabled !== false
  }

  schedulePlan(input: SuperResolutionPreloadPlanInput): Promise<SuperResolutionPreloadBatchResult> {
    this.#assertActive()
    validateContext(input.contextId, input.plan.generation)
    input.signal?.throwIfAborted()
    const selected = this.#automaticEnabled && this.#preloadEnabled
      ? pagesFromPlan(input.plan, input.pages, this.#preloadPages)
      : []
    return this.#schedule(`${input.contextId}:nearby`, input.plan.generation, input.signal, async (signal) => {
      if (!this.#automaticEnabled || !this.#preloadEnabled) {
        return emptyResult(input.contextId, input.plan.generation, "nearby", "disabled")
      }
      return this.#runPages({ ...input, generation: input.plan.generation }, "nearby", selected, signal)
    })
  }

  scheduleProgressive(input: SuperResolutionProgressiveInput): Promise<SuperResolutionPreloadBatchResult> {
    this.#assertActive()
    validateContext(input.contextId, input.generation)
    validatePageIndex(input.currentPageIndex)
    input.signal?.throwIfAborted()
    return this.#schedule(`${input.contextId}:progressive`, input.generation, input.signal, async (signal) => {
      if (!this.#automaticEnabled || !this.#progressiveEnabled) {
        return emptyResult(input.contextId, input.generation, "progressive", "disabled")
      }
      await delay(this.#progressiveDwellMs, undefined, { signal })
      const maximum = this.#progressiveMaxPages === 999 ? input.pages.length : this.#progressiveMaxPages
      const selected = input.pages
        .filter((page) => page.index > input.currentPageIndex)
        .sort((left, right) => left.index - right.index)
        .slice(0, maximum)
        .map((page): ScheduledPage => ({ page, priority: "background" }))
      return this.#runPages(input, "progressive", selected, signal)
    })
  }

  releaseContext(contextId: string, reason: unknown = abortError(`Super-resolution context released: ${contextId}`)): void {
    if (!contextId) throw new TypeError("Super-resolution context id is required.")
    for (const [key, batch] of this.#active) {
      if (!key.startsWith(`${contextId}:`)) continue
      batch.controller.abort(reason)
      this.#active.delete(key)
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    const active = [...this.#active.values()]
    this.#active.clear()
    for (const batch of active) batch.controller.abort(abortError("Super-resolution preload service disposed."))
    await Promise.allSettled(active.map((batch) => batch.promise))
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose()
  }

  #schedule(
    key: string,
    generation: number,
    callerSignal: AbortSignal | undefined,
    run: (signal: AbortSignal) => Promise<SuperResolutionPreloadBatchResult>,
  ): Promise<SuperResolutionPreloadBatchResult> {
    const current = this.#active.get(key)
    if (current) {
      if (generation < current.generation) throw abortError(`Super-resolution generation ${generation} is stale.`)
      if (generation === current.generation) return waitForSharedPromise(current.promise, callerSignal)
      current.controller.abort(abortError(`Super-resolution generation ${current.generation} was superseded by ${generation}.`))
    }
    const controller = new AbortController()
    const signal = callerSignal ? AbortSignal.any([controller.signal, callerSignal]) : controller.signal
    const promise = run(signal).finally(() => {
      if (this.#active.get(key)?.promise === promise) this.#active.delete(key)
    })
    this.#active.set(key, { generation, controller, promise })
    return promise
  }

  async #runPages(
    input: Omit<SuperResolutionPreloadPlanInput, "plan"> & { generation: number },
    mode: SuperResolutionPreloadBatchResult["mode"],
    selected: readonly ScheduledPage[],
    signal: AbortSignal,
  ): Promise<SuperResolutionPreloadBatchResult> {
    if (!selected.length) return emptyResult(input.contextId, input.generation, mode, "empty")
    const outcomes = await pMap(selected, async ({ page, priority }): Promise<SuperResolutionPreloadPageOutcome> => {
      try {
        signal.throwIfAborted()
        const destinationContext = {
          contextId: input.contextId,
          generation: input.generation,
          trigger: "preload",
          signal,
        } satisfies SuperResolutionArtifactDestinationContext
        const common = {
          page,
          trigger: "preload" as const,
          bookPath: input.bookPath,
          metadata: input.metadataFor?.(page),
          priority,
          maxMaterializationBytes: input.maxMaterializationBytes,
        }
        let output: SuperResolutionPageResult | SuperResolutionArtifactWarmResult
        if (input.artifactFor) {
          if (!this.artifactPages) throw new Error("Super-resolution artifact page service is unavailable.")
          signal.throwIfAborted()
          output = await this.artifactPages.warm({
            ...common,
            artifactFor: (decision) => input.artifactFor!(page, { ...destinationContext, decision }),
          }, { signal })
        } else {
          if (!input.destinationFor) throw new Error("Super-resolution preload requires artifactFor or destinationFor.")
          const destinationPath = await input.destinationFor(page, destinationContext)
          signal.throwIfAborted()
          output = await this.pages.run({ ...common, destinationPath }, { signal })
        }
        const outcome = { pageId: page.id, pageIndex: page.index, status: "settled" as const, output }
        notify(input.onPageSettled, outcome)
        return outcome
      } catch (error) {
        const outcome = {
          pageId: page.id,
          pageIndex: page.index,
          status: signal.aborted ? "cancelled" as const : "failed" as const,
          error,
        }
        notify(input.onPageSettled, outcome)
        return outcome
      }
    }, { concurrency: this.#concurrency })
    return {
      contextId: input.contextId,
      generation: input.generation,
      mode,
      reason: "completed",
      planned: selected.length,
      settled: outcomes.filter((outcome) => outcome.status === "settled").length,
      failed: outcomes.filter((outcome) => outcome.status === "failed").length,
      cancelled: outcomes.filter((outcome) => outcome.status === "cancelled").length,
      outcomes,
    }
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("Super-resolution preload service is disposed.")
  }
}

function pagesFromPlan(plan: ReaderPreloadPlan, pages: readonly ReaderPage[], maximum: number): ScheduledPage[] {
  const byIndex = new Map(pages.map((page) => [page.index, page]))
  const selected = new Set<number>()
  const output: ScheduledPage[] = []
  for (const candidate of plan.candidates) {
    for (const pageIndex of candidate.pageIndexes) {
      if (output.length >= maximum) return output
      if (selected.has(pageIndex)) continue
      const page = byIndex.get(pageIndex)
      if (!page) continue
      selected.add(pageIndex)
      output.push({ page, priority: candidate.priority })
    }
  }
  return output
}

function emptyResult(
  contextId: string,
  generation: number,
  mode: SuperResolutionPreloadBatchResult["mode"],
  reason: "disabled" | "empty",
): SuperResolutionPreloadBatchResult {
  return { contextId, generation, mode, reason, planned: 0, settled: 0, failed: 0, cancelled: 0, outcomes: [] }
}

async function waitForSharedPromise<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      },
    )
  })
}

function validateContext(contextId: string, generation: number): void {
  if (!contextId || contextId.length > 1_024) throw new TypeError("Super-resolution context id must contain 1..1024 characters.")
  if (!Number.isSafeInteger(generation) || generation < 0) throw new RangeError("Super-resolution generation must be non-negative.")
}

function validatePageIndex(pageIndex: number): void {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) throw new RangeError("Super-resolution page index must be non-negative.")
}

function boundedInteger(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`Super-resolution ${label} must be an integer from ${minimum} to ${maximum}.`)
  }
  return value
}

function abortError(message: string): DOMException {
  return new DOMException(message, "AbortError")
}

function notify(
  observer: SuperResolutionPreloadPlanInput["onPageSettled"],
  outcome: SuperResolutionPreloadPageOutcome,
): void {
  try {
    observer?.(outcome)
  } catch {
    // Progress observers cannot change the outcome of completed background work.
  }
}
