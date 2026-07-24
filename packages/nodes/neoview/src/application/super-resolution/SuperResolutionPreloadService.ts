import pMap from "p-map"
import { setTimeout as delay } from "node:timers/promises"
import { LRUCache } from "lru-cache"

import type { SuperResolutionPreferences } from "../../domain/super-resolution/super-resolution-preferences.js"
import type { ReaderPage } from "../../domain/page/page.js"
import type { ResourcePriority } from "../../ports/ResourceScheduler.js"
import type { ReaderPreloadPlan } from "../../ports/ReaderPreload.js"
import type { SuperResolutionPreloadPageState } from "../../ports/SuperResolutionPreloadControlPort.js"
import type { SuperResolutionPageResult } from "../../ports/SuperResolutionPage.js"
import type {
  SuperResolutionArtifactWarmResult,
  SuperResolutionArtifactPageInput,
} from "../../ports/SuperResolutionArtifact.js"
import type {
  SuperResolutionArtifactDestinationContext,
  SuperResolutionPreloadBatchResult,
  SuperResolutionPreloadLiveSnapshot,
  SuperResolutionPreloadLiveState,
  SuperResolutionPreloadLogEntry,
  SuperResolutionPreloadPageOutcome,
  SuperResolutionPreloadPageRunner,
  SuperResolutionPreloadPlanInput,
  SuperResolutionProgressiveInput,
} from "../../ports/SuperResolutionPreload.js"

export type {
  SuperResolutionArtifactDestinationContext,
  SuperResolutionArtifactDestinationResolver,
  SuperResolutionArtifactDescriptorResolver,
  SuperResolutionPreloadBatchResult,
  SuperResolutionPreloadLiveSnapshot,
  SuperResolutionPreloadPageOutcome,
  SuperResolutionPreloadPlanInput,
  SuperResolutionPreloadPageRunner,
  SuperResolutionProgressiveInput,
  SuperResolutionPreloadLiveState,
} from "../../ports/SuperResolutionPreload.js"

interface SuperResolutionArtifactPageWarmer {
  warm(input: SuperResolutionArtifactPageInput, context?: { signal?: AbortSignal }): Promise<SuperResolutionArtifactWarmResult>
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

interface NearbyTarget {
  version: number
  input: Omit<SuperResolutionPreloadPlanInput, "signal">
  selected: readonly ScheduledPage[]
}

interface ContextCoverage {
  totalPages: number
  scheduled: Set<number>
  reserved: Set<number>
  processed: Set<number>
  upscaled: Set<number>
  priorities: Map<number, ResourcePriority>
}

type StoredRequest =
  | { mode: "nearby"; input: SuperResolutionPreloadPlanInput }
  | { mode: "progressive"; input: SuperResolutionProgressiveInput }

interface TrackedBatch {
  request: StoredRequest
  snapshot: SuperResolutionPreloadLiveSnapshot
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
  readonly #nearbyTargets = new Map<string, NearbyTarget>()
  readonly #tracked = new LRUCache<string, TrackedBatch>({ max: 128 })
  readonly #coverage = new Map<string, ContextCoverage>()
  readonly #progressiveUnlocked = new Set<string>()
  #eventSequence = 0
  #nearbyTargetVersion = 0
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
      ? nearbyPages(input.plan, input.pages, this.#preloadPages)
      : []
    const key = `${input.contextId}:nearby`
    const previousTarget = this.#nearbyTargets.get(key)
    const current = this.#active.get(key)
    if (current && input.plan.generation < current.generation) {
      throw abortError(`Super-resolution generation ${input.plan.generation} is stale.`)
    }
    this.#registerScheduled(input.contextId, input.pages.length, selected)
    const storedInput = { ...input, signal: undefined }
    this.#nearbyTargets.set(key, { version: ++this.#nearbyTargetVersion, input: storedInput, selected })
    if (current) {
      current.generation = input.plan.generation
      const tracked = this.#tracked.peek(key)
      if (tracked) tracked.request = { mode: "nearby", input: storedInput }
      const completed = tracked
        ? tracked.snapshot.settled + tracked.snapshot.failed + tracked.snapshot.cancelled
        : 0
      const coverage = this.#coverageFor(input.contextId, input.pages.length)
      const running = new Set(
        previousTarget?.selected
          .map(({ page }) => page.index)
          .filter((pageIndex) => coverage.reserved.has(pageIndex)) ?? [],
      )
      const queued = selected.filter(({ page }) => !coverage.processed.has(page.index) && !coverage.reserved.has(page.index)).length
      this.#update(key, {
        generation: input.plan.generation,
        state: "running",
        planned: completed + running.size + queued,
        pending: running.size + queued,
      })
      this.#syncCoverage(input.contextId)
      this.#appendEvent(key, { level: "info", message: `Preload batch retargeted ${input.plan.direction}.` })
      return waitForSharedPromise(current.promise, input.signal)
    }
    this.#track(key, { mode: "nearby", input: storedInput }, "queued", input.plan.generation)
    const planned = this.#availableCount(input.contextId, input.pages.length, selected)
    this.#update(key, { planned, pending: planned })
    this.#syncCoverage(input.contextId)
    const controller = new AbortController()
    const operation = this.#drainNearby(key, controller.signal).finally(() => {
      if (this.#active.get(key)?.promise === operation) this.#active.delete(key)
      this.#nearbyTargets.delete(key)
    })
    this.#active.set(key, { generation: input.plan.generation, controller, promise: operation })
    const observed = this.#observe(key, operation)
    return waitForSharedPromise(observed, input.signal)
  }

  scheduleProgressive(input: SuperResolutionProgressiveInput): Promise<SuperResolutionPreloadBatchResult> {
    this.#assertActive()
    validateContext(input.contextId, input.generation)
    validatePageIndex(input.currentPageIndex)
    input.signal?.throwIfAborted()
    const key = `${input.contextId}:progressive`
    const maximum = this.#progressiveMaxPages === 999 ? input.pages.length : this.#progressiveMaxPages
    const nearbyOffset = this.#preloadEnabled ? this.#preloadPages : 0
    const selected = forwardPages(input.pages, input.currentPageIndex, nearbyOffset, maximum, "background")
    const current = this.#active.get(key)
    const state = this.#tracked.peek(key)?.snapshot.state
    if (current && state === "running" && input.generation >= current.generation) {
      return this.#appendProgressive(key, current, input, selected)
    }
    const unlocked = this.#progressiveUnlocked.has(input.contextId)
    this.#track(
      key,
      { mode: "progressive", input: { ...input, signal: undefined } },
      unlocked ? "queued" : "countdown",
      input.generation,
    )
    this.#update(key, {
      planned: this.#availableCount(input.contextId, input.pages.length, selected),
      pending: this.#availableCount(input.contextId, input.pages.length, selected),
    })
    return this.#observe(key, this.#schedule(key, input.generation, input.signal, async (signal) => {
      if (!this.#automaticEnabled || !this.#progressiveEnabled) {
        return emptyResult(input.contextId, input.generation, "progressive", "disabled")
      }
      if (!this.#progressiveUnlocked.has(input.contextId)) {
        await delay(this.#progressiveDwellMs, undefined, { signal })
        this.#progressiveUnlocked.add(input.contextId)
      }
      await this.#waitForNearby(input.contextId, input.generation, signal)
      this.#registerScheduled(input.contextId, input.pages.length, selected)
      return this.#runPages(input, "progressive", selected, signal)
    }))
  }

  snapshots(contextId: string): readonly SuperResolutionPreloadLiveSnapshot[] {
    validateContext(contextId, 0)
    return (["nearby", "progressive"] as const).flatMap((mode) => {
      const snapshot = this.#tracked.get(`${contextId}:${mode}`)?.snapshot
      return snapshot ? [{ ...snapshot }] : []
    })
  }

  pageState(contextId: string, pageIndex: number): SuperResolutionPreloadPageState {
    validateContext(contextId, 0)
    validatePageIndex(pageIndex)
    const coverage = this.#coverage.get(contextId)
    if (!coverage?.scheduled.has(pageIndex)) return "none"
    return coverage.processed.has(pageIndex) ? "settled" : "pending"
  }

  async pause(contextId: string): Promise<readonly SuperResolutionPreloadLiveSnapshot[]> {
    validateContext(contextId, 0)
    this.#progressiveUnlocked.delete(contextId)
    const active: Promise<SuperResolutionPreloadBatchResult>[] = []
    for (const mode of ["nearby", "progressive"] as const) {
      const key = `${contextId}:${mode}`
      const batch = this.#active.get(key)
      if (batch) {
        if (mode === "nearby") this.#nearbyTargets.delete(key)
        batch.controller.abort(abortError(`Super-resolution ${mode} paused.`))
        active.push(batch.promise)
        this.#update(key, { state: "paused", completedAt: Date.now() })
      }
    }
    await Promise.allSettled(active)
    return this.snapshots(contextId)
  }

  retry(contextId: string, mode: "nearby" | "progressive"): Promise<SuperResolutionPreloadBatchResult> {
    validateContext(contextId, 0)
    const request = this.#tracked.get(`${contextId}:${mode}`)?.request
    if (!request) throw new Error(`No super-resolution ${mode} request is available to retry.`)
    return request.mode === "nearby"
      ? this.schedulePlan(request.input)
      : this.scheduleProgressive(request.input)
  }

  async advanceGeneration(contextId: string, generation: number): Promise<void> {
    validateContext(contextId, generation)
    const pending: Promise<unknown>[] = []
    for (const mode of ["nearby", "progressive"] as const) {
      const key = `${contextId}:${mode}`
      const batch = this.#active.get(key)
      if (!batch || batch.generation >= generation) continue
      const state = this.#tracked.peek(key)?.snapshot.state
      if ((mode === "nearby" || mode === "progressive") && state === "running") continue
      batch.controller.abort(abortError(`Super-resolution ${mode} generation ${batch.generation} was superseded by ${generation}.`))
      pending.push(batch.promise)
    }
    await Promise.allSettled(pending)
    for (const mode of ["nearby", "progressive"] as const) {
      const key = `${contextId}:${mode}`
      const tracked = this.#tracked.peek(key)
      if (tracked && tracked.snapshot.generation < generation && !((mode === "nearby" || mode === "progressive") && tracked.snapshot.state === "running")) {
        this.#tracked.delete(key)
      }
    }
  }

  releaseContext(contextId: string, reason: unknown = abortError(`Super-resolution context released: ${contextId}`)): void {
    if (!contextId) throw new TypeError("Super-resolution context id is required.")
    for (const [key, batch] of this.#active) {
      if (!key.startsWith(`${contextId}:`)) continue
      batch.controller.abort(reason)
      this.#active.delete(key)
    }
    this.#tracked.delete(`${contextId}:nearby`)
    this.#tracked.delete(`${contextId}:progressive`)
    this.#nearbyTargets.delete(`${contextId}:nearby`)
    this.#coverage.delete(contextId)
    this.#progressiveUnlocked.delete(contextId)
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    const active = [...this.#active.values()]
    this.#active.clear()
    this.#tracked.clear()
    this.#nearbyTargets.clear()
    this.#coverage.clear()
    this.#progressiveUnlocked.clear()
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
    let predecessor: Promise<unknown> | undefined
    if (current) {
      if (generation < current.generation) throw abortError(`Super-resolution generation ${generation} is stale.`)
      if (generation === current.generation) return waitForSharedPromise(current.promise, callerSignal)
      current.controller.abort(abortError(`Super-resolution generation ${current.generation} was superseded by ${generation}.`))
      predecessor = current.promise.catch(() => undefined)
    }
    const controller = new AbortController()
    const signal = callerSignal ? AbortSignal.any([controller.signal, callerSignal]) : controller.signal
    const promise = (async () => {
      await predecessor
      signal.throwIfAborted()
      return run(signal)
    })().finally(() => {
      if (this.#active.get(key)?.promise === promise) this.#active.delete(key)
    })
    this.#active.set(key, { generation, controller, promise })
    return promise
  }

  #appendProgressive(
    key: string,
    current: ActiveBatch,
    input: SuperResolutionProgressiveInput,
    selected: readonly ScheduledPage[],
  ): Promise<SuperResolutionPreloadBatchResult> {
    const tracked = this.#tracked.peek(key)
    if (tracked) {
      tracked.request = { mode: "progressive", input: { ...input, signal: undefined } }
      this.#update(key, { generation: input.generation, state: "running" })
    }
    this.#registerScheduled(input.contextId, input.pages.length, selected)
    const signal = current.controller.signal
    const promise = (async () => {
      const previous = await current.promise
      signal.throwIfAborted()
      const extension = await this.#runPages(input, "progressive", selected, signal, true)
      return mergeBatchResults(previous, extension, input.generation)
    })().finally(() => {
      if (this.#active.get(key)?.promise === promise) this.#active.delete(key)
    })
    this.#active.set(key, { generation: input.generation, controller: current.controller, promise })
    return this.#observe(key, waitForSharedPromise(promise, input.signal))
  }

  async #waitForNearby(contextId: string, generation: number, signal: AbortSignal): Promise<void> {
    const nearby = this.#active.get(`${contextId}:nearby`)
    if (!nearby || nearby.generation > generation) return
    await waitForSharedPromise(nearby.promise, signal)
  }

  #coverageFor(contextId: string, totalPages: number): ContextCoverage {
    const current = this.#coverage.get(contextId)
    if (current) {
      current.totalPages = totalPages
      return current
    }
    const created: ContextCoverage = {
      totalPages,
      scheduled: new Set(),
      reserved: new Set(),
      processed: new Set(),
      upscaled: new Set(),
      priorities: new Map(),
    }
    this.#coverage.set(contextId, created)
    return created
  }

  #availableCount(contextId: string, totalPages: number, pages: readonly ScheduledPage[]): number {
    const coverage = this.#coverageFor(contextId, totalPages)
    return pages.filter(({ page }) => !coverage.processed.has(page.index) && !coverage.reserved.has(page.index)).length
  }

  async #drainNearby(key: string, signal: AbortSignal): Promise<SuperResolutionPreloadBatchResult> {
    let combined: SuperResolutionPreloadBatchResult | undefined
    let attemptedVersion = -1
    const attempted = new Set<number>()
    while (true) {
      signal.throwIfAborted()
      const target = this.#nearbyTargets.get(key)
      if (!target) break
      if (target.version !== attemptedVersion) {
        attemptedVersion = target.version
        attempted.clear()
      }
      const generation = target.input.plan.generation
      if (!this.#automaticEnabled || !this.#preloadEnabled) {
        return emptyResult(target.input.contextId, generation, "nearby", "disabled")
      }
      const coverage = this.#coverageFor(target.input.contextId, target.input.pages.length)
      const wave = target.selected
        .filter(({ page }) => !attempted.has(page.index) && !coverage.processed.has(page.index) && !coverage.reserved.has(page.index))
        .slice(0, this.#concurrency)
      if (!wave.length) {
        if (this.#nearbyTargets.get(key)?.version === target.version) break
        continue
      }
      for (const { page } of wave) attempted.add(page.index)
      const result = await this.#runPages(
        { ...target.input, generation },
        "nearby",
        wave,
        signal,
        combined !== undefined,
      )
      combined = combined ? mergeBatchResults(combined, result, generation, "nearby") : result
      if (signal.aborted) return combined
    }
    const latest = this.#nearbyTargets.get(key)
    return combined ?? emptyResult(latest?.input.contextId ?? key.slice(0, -":nearby".length), latest?.input.plan.generation ?? 0, "nearby", "empty")
  }

  #registerScheduled(contextId: string, totalPages: number, pages: readonly ScheduledPage[]): void {
    const coverage = this.#coverageFor(contextId, totalPages)
    for (const { page, priority } of pages) {
      coverage.scheduled.add(page.index)
      const current = coverage.priorities.get(page.index)
      if (!current || priorityRank(priority) > priorityRank(current)) coverage.priorities.set(page.index, priority)
    }
    this.#syncCoverage(contextId)
  }

  #reservePages(contextId: string, totalPages: number, pages: readonly ScheduledPage[]): ScheduledPage[] {
    const coverage = this.#coverageFor(contextId, totalPages)
    const selected: ScheduledPage[] = []
    for (const candidate of pages) {
      if (coverage.processed.has(candidate.page.index) || coverage.reserved.has(candidate.page.index)) continue
      coverage.reserved.add(candidate.page.index)
      selected.push(candidate)
    }
    this.#syncCoverage(contextId)
    return selected
  }

  #syncCoverage(contextId: string): void {
    const coverage = this.#coverage.get(contextId)
    if (!coverage) return
    for (const mode of ["nearby", "progressive"] as const) {
      const key = `${contextId}:${mode}`
      if (!this.#tracked.peek(key)) continue
      const targetIndexes = mode === "nearby"
        ? new Set(this.#nearbyTargets.get(key)?.selected.map(({ page }) => page.index) ?? [])
        : new Set<number>()
      this.#update(key, {
        totalPages: coverage.totalPages,
        scheduledPages: coverage.scheduled.size,
        upscaledPages: coverage.upscaled.size,
        queuedPageIndexes: [...targetIndexes]
          .filter((pageIndex) => !coverage.processed.has(pageIndex) && !coverage.reserved.has(pageIndex))
          .sort((left, right) => left - right),
        processingPageIndexes: [...coverage.reserved].sort((left, right) => left - right),
        upscaledPageIndexes: [...coverage.upscaled].sort((left, right) => left - right),
      })
    }
  }

  async #runPages(
    input: Omit<SuperResolutionPreloadPlanInput, "plan"> & { generation: number },
    mode: SuperResolutionPreloadBatchResult["mode"],
    selected: readonly ScheduledPage[],
    signal: AbortSignal,
    append = false,
  ): Promise<SuperResolutionPreloadBatchResult> {
    const runnable = this.#reservePages(input.contextId, input.pages.length, selected)
    if (!runnable.length) return emptyResult(input.contextId, input.generation, mode, "empty")
    const key = `${input.contextId}:${mode}`
    const snapshot = this.#tracked.peek(key)?.snapshot
    this.#update(key, mode === "nearby" ? {
      state: "running",
    } : {
      state: "running",
      planned: (append ? snapshot?.planned ?? 0 : 0) + runnable.length,
      settled: append ? snapshot?.settled ?? 0 : 0,
      failed: append ? snapshot?.failed ?? 0 : 0,
      cancelled: append ? snapshot?.cancelled ?? 0 : 0,
      pending: (append ? snapshot?.pending ?? 0 : 0) + runnable.length,
      progress: append ? snapshot?.progress ?? 0 : 0,
    })
    const outcomes = await pMap(runnable, async ({ page, priority }): Promise<SuperResolutionPreloadPageOutcome> => {
      try {
        signal.throwIfAborted()
        this.#appendEvent(key, { level: "info", pageIndex: page.index, message: `Started page ${page.index + 1}.` })
        await input.preparePage?.(page, signal)
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
          priority: this.#coverage.get(input.contextId)?.priorities.get(page.index) ?? priority,
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
        this.#recordOutcome(key, page.index, outcome.status, outputProvidesUpscale(output))
        this.#appendEvent(key, { level: "success", pageIndex: page.index, message: `Finished page ${page.index + 1}.` })
        notify(input.onPageSettled, outcome)
        return outcome
      } catch (error) {
        const outcome = {
          pageId: page.id,
          pageIndex: page.index,
          status: signal.aborted ? "cancelled" as const : "failed" as const,
          error,
        }
        this.#recordOutcome(key, page.index, outcome.status, false)
        this.#appendEvent(key, { level: "error", pageIndex: page.index, message: `Page ${page.index + 1} failed: ${errorMessage(error)}` })
        notify(input.onPageSettled, outcome)
        return outcome
      }
    }, { concurrency: this.#concurrency })
    return {
      contextId: input.contextId,
      generation: input.generation,
      mode,
      reason: "completed",
      planned: runnable.length,
      settled: outcomes.filter((outcome) => outcome.status === "settled").length,
      failed: outcomes.filter((outcome) => outcome.status === "failed").length,
      cancelled: outcomes.filter((outcome) => outcome.status === "cancelled").length,
      outcomes,
    }
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("Super-resolution preload service is disposed.")
  }

  #track(
    key: string,
    request: StoredRequest,
    state: SuperResolutionPreloadLiveState,
    generation: number,
  ): void {
    const current = this.#tracked.peek(key)
    if (current?.snapshot.generation === generation && this.#active.has(key)) {
      current.request = request
      return
    }
    const now = Date.now()
    const coverage = this.#coverageFor(request.input.contextId, request.input.pages.length)
    this.#tracked.set(key, {
      request,
      snapshot: {
        contextId: request.input.contextId,
        generation,
        mode: request.mode,
        state,
        planned: 0,
        settled: 0,
        failed: 0,
        cancelled: 0,
        pending: 0,
        progress: 0,
        totalPages: coverage.totalPages,
        scheduledPages: coverage.scheduled.size,
        upscaledPages: coverage.upscaled.size,
        upscaledPageIndexes: [...coverage.upscaled].sort((left, right) => left - right),
        startedAt: now,
        updatedAt: now,
        events: [this.#createEvent(key, { at: now, level: "info", message: batchStateMessage(state) })],
      },
    })
  }

  #update(key: string, patch: Partial<SuperResolutionPreloadLiveSnapshot>): void {
    const tracked = this.#tracked.peek(key)
    if (!tracked) return
    tracked.snapshot = { ...tracked.snapshot, ...patch, updatedAt: Date.now() }
  }

  #appendEvent(key: string, event: Omit<SuperResolutionPreloadLogEntry, "id" | "at">): void {
    const snapshot = this.#tracked.peek(key)?.snapshot
    if (!snapshot) return
    this.#update(key, { events: [...(snapshot.events ?? []), this.#createEvent(key, { ...event, at: Date.now() })].slice(-64) })
  }

  #createEvent(key: string, event: Omit<SuperResolutionPreloadLogEntry, "id">): SuperResolutionPreloadLogEntry {
    return { ...event, id: `${key}:${++this.#eventSequence}` }
  }

  #recordOutcome(
    key: string,
    pageIndex: number,
    status: SuperResolutionPreloadPageOutcome["status"],
    upscaled: boolean,
  ): void {
    const tracked = this.#tracked.peek(key)
    if (!tracked) return
    const snapshot = tracked.snapshot
    const coverage = this.#coverage.get(snapshot.contextId)
    coverage?.reserved.delete(pageIndex)
    if (status === "settled") coverage?.processed.add(pageIndex)
    if (upscaled) coverage?.upscaled.add(pageIndex)
    const settled = snapshot.settled + (status === "settled" ? 1 : 0)
    const failed = snapshot.failed + (status === "failed" ? 1 : 0)
    const cancelled = snapshot.cancelled + (status === "cancelled" ? 1 : 0)
    const completed = settled + failed + cancelled
    this.#update(key, {
      settled,
      failed,
      cancelled,
      pending: Math.max(0, snapshot.planned - completed),
      progress: snapshot.planned ? settled / snapshot.planned : 0,
    })
    this.#syncCoverage(snapshot.contextId)
  }

  async #observe(
    key: string,
    operation: Promise<SuperResolutionPreloadBatchResult>,
  ): Promise<SuperResolutionPreloadBatchResult> {
    try {
      const result = await operation
      const active = this.#active.get(key)
      if (active && active.promise !== operation) return result
      const paused = this.#tracked.peek(key)?.snapshot.state === "paused"
      const state = paused
        ? "paused"
        : result.reason === "disabled" ? "disabled" : result.reason === "empty" ? "empty" : "completed"
      this.#update(key, {
        state,
        planned: result.planned,
        settled: result.settled,
        failed: result.failed,
        cancelled: result.cancelled,
        pending: 0,
        progress: result.planned ? result.settled / result.planned : 0,
        completedAt: Date.now(),
      })
      this.#appendEvent(key, { level: result.failed ? "error" : "success", message: `Batch ${state}: ${result.settled} settled, ${result.failed} failed.` })
      return result
    } catch (error) {
      const active = this.#active.get(key)
      if (active && active.promise !== operation) throw error
      const snapshot = this.#tracked.peek(key)?.snapshot
      const paused = snapshot?.state === "paused"
      this.#update(key, {
        state: paused ? "paused" : isAbortError(error) ? "cancelled" : "failed",
        pending: 0,
        completedAt: Date.now(),
      })
      this.#appendEvent(key, { level: "error", message: `Batch failed: ${errorMessage(error)}` })
      throw error
    }
  }
}

function nearbyPages(plan: ReaderPreloadPlan, pages: readonly ReaderPage[], maximum: number): ScheduledPage[] {
  if (plan.admission === "paused") return []
  const current = new Set(plan.currentPageIndexes)
  const first = Math.min(...plan.currentPageIndexes)
  const last = Math.max(...plan.currentPageIndexes)
  const preferred = pages
    .filter((page) => !current.has(page.index) && (plan.direction === "forward" ? page.index > last : page.index < first))
    .sort((left, right) => plan.direction === "forward" ? left.index - right.index : right.index - left.index)
    .map((page) => ({ page, priority: "ahead" as const }))
  const reverse = pages
    .filter((page) => !current.has(page.index) && (plan.direction === "forward" ? page.index < first : page.index > last))
    .sort((left, right) => plan.direction === "forward" ? right.index - left.index : left.index - right.index)
    .map((page) => ({ page, priority: "background" as const }))
  return [...preferred, ...reverse].slice(0, maximum)
}

function forwardPages(
  pages: readonly ReaderPage[],
  currentPageIndex: number,
  offset: number,
  maximum: number,
  priority: ResourcePriority,
): ScheduledPage[] {
  return pages
    .filter((page) => page.index > currentPageIndex + offset)
    .sort((left, right) => left.index - right.index)
    .slice(0, maximum)
    .map((page) => ({ page, priority }))
}

function priorityRank(priority: ResourcePriority): number {
  switch (priority) {
    case "interactive": return 4
    case "view": return 3
    case "ahead": return 2
    case "background": return 1
  }
}

function mergeBatchResults(
  previous: SuperResolutionPreloadBatchResult,
  extension: SuperResolutionPreloadBatchResult,
  generation: number,
  mode: SuperResolutionPreloadBatchResult["mode"] = "progressive",
): SuperResolutionPreloadBatchResult {
  return {
    contextId: previous.contextId,
    generation,
    mode,
    reason: previous.reason === "completed" || extension.reason === "completed" ? "completed" : extension.reason,
    planned: previous.planned + extension.planned,
    settled: previous.settled + extension.settled,
    failed: previous.failed + extension.failed,
    cancelled: previous.cancelled + extension.cancelled,
    outcomes: [...previous.outcomes, ...extension.outcomes],
  }
}

function outputProvidesUpscale(output: SuperResolutionPageResult | SuperResolutionArtifactWarmResult): boolean {
  if ("status" in output) return output.status === "hit" || output.status === "shared" || output.status === "generated"
  return output.decision.kind === "run" && output.result !== undefined
}

function batchStateMessage(state: SuperResolutionPreloadLiveState): string {
  if (state === "countdown") return "Waiting for progressive preload dwell time."
  if (state === "queued") return "Preload batch queued."
  return `Preload batch ${state}.`
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 512 ? `${message.slice(0, 509)}...` : message
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
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
