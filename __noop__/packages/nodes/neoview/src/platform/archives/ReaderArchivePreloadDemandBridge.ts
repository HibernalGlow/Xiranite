import type { ReaderPage } from "../../domain/page/page.js"
import type { ReaderPreloadPlan } from "../../application/preloading/PreloadCoordinator.js"
import type { ArchivePreloadDemandTarget } from "../../ports/ArchiveProvider.js"

interface SessionDemandState {
  generation: number
  direction: ReaderPreloadPlan["direction"]
  directionConfidence: number
  targets: ReadonlyMap<object, ArchivePreloadDemandTarget>
}

/**
 * Bridges page-level preload plans to archive providers without opening page
 * content. Updates are serialized per session so a stale direction change
 * cannot arrive after a newer generation.
 */
export class ReaderArchivePreloadDemandBridge implements AsyncDisposable {
  readonly #states = new Map<string, SessionDemandState>()
  readonly #updates = new Map<string, Promise<void>>()

  update(
    sessionId: string,
    pages: readonly ReaderPage[],
    plan: ReaderPreloadPlan | undefined,
    demandedPageIds?: ReadonlySet<string>,
  ): Promise<void> {
    const operation = (this.#updates.get(sessionId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.#apply(sessionId, pages, plan, demandedPageIds))
    const tracked = operation.finally(() => {
      if (this.#updates.get(sessionId) === tracked) this.#updates.delete(sessionId)
    })
    this.#updates.set(sessionId, tracked)
    return tracked
  }

  async release(sessionId: string): Promise<void> {
    const queued = this.#updates.get(sessionId)
    if (!this.#states.has(sessionId) && !queued) return
    const operation = (queued ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const previous = this.#states.get(sessionId)
      if (!previous) return
      const generation = previous.generation + 1
      await Promise.all([...previous.targets.values()].map((target) => target.update({
        generation,
        direction: previous.direction,
        directionConfidence: 0,
        targetIds: [],
      })))
      this.#states.delete(sessionId)
    })
    const tracked = operation.finally(() => {
      if (this.#updates.get(sessionId) === tracked) this.#updates.delete(sessionId)
    })
    this.#updates.set(sessionId, tracked)
    await tracked
  }

  async close(): Promise<void> {
    const sessionIds = new Set([...this.#states.keys(), ...this.#updates.keys()])
    await Promise.all([...sessionIds].map((sessionId) => this.release(sessionId)))
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }

  async #apply(
    sessionId: string,
    pages: readonly ReaderPage[],
    plan: ReaderPreloadPlan | undefined,
    demandedPageIds?: ReadonlySet<string>,
  ): Promise<void> {
    const previous = this.#states.get(sessionId)
    if (!plan) {
      if (previous) {
        await Promise.all([...previous.targets.values()].map((target) => target.update({
          generation: previous.generation + 1,
          direction: previous.direction,
          directionConfidence: 0,
          targetIds: [],
        })))
      }
      this.#states.delete(sessionId)
      return
    }

    const pagesById = new Map(pages.map((page) => [page.id, page]))
    const current = new Map<object, { target: ArchivePreloadDemandTarget; entryIds: string[] }>()
    for (const candidate of plan.candidates) {
      // Reverse background candidates are intentionally not sent to a solid
      // extractor: they would force it to seek across the opposite tail.
      if (candidate.tier === "background") continue
      for (const pageId of candidate.pageIds) {
        if (demandedPageIds && !demandedPageIds.has(pageId)) continue
        const content = pagesById.get(pageId)?.content as {
          archivePreloadTarget?: ArchivePreloadDemandTarget
        } | undefined
        const target = content?.archivePreloadTarget
        if (!target) continue
        const group = current.get(target.owner) ?? { target, entryIds: [] }
        if (!group.entryIds.includes(target.entryId)) group.entryIds.push(target.entryId)
        current.set(target.owner, group)
      }
    }

    const owners = new Set([...previous?.targets.keys() ?? [], ...current.keys()])
    await Promise.all([...owners].map(async (owner) => {
      const next = current.get(owner)
      const old = previous?.targets.get(owner)
      const target = next?.target ?? old
      if (!target) return
      await target.update({
        generation: plan.generation,
        direction: plan.direction,
        directionConfidence: plan.directionConfidence,
        targetIds: next?.entryIds ?? [],
      })
    }))

    this.#states.set(sessionId, {
      generation: plan.generation,
      direction: plan.direction,
      directionConfidence: plan.directionConfidence,
      targets: new Map([...current].map(([owner, group]) => [owner, group.target])),
    })
  }
}
