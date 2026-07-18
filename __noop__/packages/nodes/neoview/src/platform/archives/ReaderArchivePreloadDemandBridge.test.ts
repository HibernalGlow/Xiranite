import { describe, expect, it, vi } from "vitest"

import type { ReaderPage } from "../../domain/page/page.js"
import type { ReaderPreloadPlan } from "../../application/preloading/PreloadCoordinator.js"
import type { ArchivePreloadDemandTarget } from "../../ports/ArchiveProvider.js"
import { ReaderArchivePreloadDemandBridge } from "./ReaderArchivePreloadDemandBridge.js"

describe("ReaderArchivePreloadDemandBridge", () => {
  it("groups near/ahead entries by provider and excludes reverse background work", async () => {
    const first = target("a1", "provider-a")
    const second = target("a2", "provider-a", undefined, first.owner)
    const other = target("b1", "provider-b")
    const background = target("b2", "provider-b", undefined, other.owner)
    const bridge = new ReaderArchivePreloadDemandBridge()
    await bridge.update("reader-1", pages(first, second, other, background), plan(4, [
      { tier: "near", pageIds: ["page-0"] },
      { tier: "ahead", pageIds: ["page-1", "page-2"] },
      { tier: "background", pageIds: ["page-3"] },
    ]))

    expect(first.update).toHaveBeenCalledWith(expect.objectContaining({ generation: 4, direction: "forward", targetIds: ["a1", "a2"] }))
    expect(other.update).toHaveBeenCalledWith(expect.objectContaining({ targetIds: ["b1"] }))
    expect(background.update).not.toHaveBeenCalled()
    await bridge.close()
  })

  it("only forwards page IDs explicitly reported as started", async () => {
    const first = target("a1", "provider-a")
    const second = target("a2", "provider-a", undefined, first.owner)
    const bridge = new ReaderArchivePreloadDemandBridge()
    await bridge.update("reader-1", pages(first, second), plan(5, [
      { tier: "near", pageIds: ["page-0", "page-1"] },
    ]), new Set(["page-1"]))
    expect(first.update).not.toHaveBeenCalled()
    expect(second.update).toHaveBeenCalledWith(expect.objectContaining({ targetIds: ["a2"] }))
    await bridge.close()
  })

  it("clears providers removed by a newer plan and on session release", async () => {
    const first = target("a1", "provider-a")
    const second = target("b1", "provider-b")
    const bridge = new ReaderArchivePreloadDemandBridge()
    const book = pages(first, second)
    await bridge.update("reader-1", book, plan(1, [{ tier: "ahead", pageIds: ["page-0"] }]))
    await bridge.update("reader-1", book, plan(2, [{ tier: "ahead", pageIds: ["page-1"] }]))
    expect(first.update).toHaveBeenLastCalledWith(expect.objectContaining({ generation: 2, targetIds: [] }))
    expect(second.update).toHaveBeenLastCalledWith(expect.objectContaining({ generation: 2, targetIds: ["b1"] }))
    await bridge.release("reader-1")
    expect(second.update).toHaveBeenLastCalledWith(expect.objectContaining({ generation: 3, targetIds: [] }))
    await bridge.close()
  })

  it("serializes updates for one session", async () => {
    let unblock!: () => void
    const firstUpdate = new Promise<void>((resolve) => { unblock = resolve })
    const first = target("a1", "provider-a", vi.fn(async (demand) => {
      if (demand.generation === 1) await firstUpdate
    }))
    const bridge = new ReaderArchivePreloadDemandBridge()
    const book = pages(first)
    const firstPlan = bridge.update("reader-1", book, plan(1, [{ tier: "ahead", pageIds: ["page-0"] }]))
    const secondPlan = bridge.update("reader-1", book, plan(2, [{ tier: "ahead", pageIds: ["page-0"] }]))
    const release = bridge.release("reader-1")
    await vi.waitFor(() => expect(first.update).toHaveBeenCalledTimes(1))
    unblock()
    await Promise.all([firstPlan, secondPlan, release])
    expect(first.update).toHaveBeenCalledTimes(3)
    expect(first.update).toHaveBeenLastCalledWith(expect.objectContaining({ generation: 3, targetIds: [] }))
    await bridge.close()
  })
})

function target(
  entryId: string,
  ownerId: string,
  update?: ArchivePreloadDemandTarget["update"],
  owner: object = { ownerId },
): ArchivePreloadDemandTarget {
  return {
    owner,
    entryId,
    update: update ?? vi.fn(async () => undefined),
  }
}

function pages(...targets: readonly ArchivePreloadDemandTarget[]): ReaderPage[] {
  return targets.map((target, index) => ({
    id: `page-${index}`,
    index,
    name: `${index}.jpg`,
    sourcePath: `page-${index}.jpg`,
    mediaKind: "image",
    contentVersion: `v${index}`,
    content: {
      load: async () => ({}) as never,
      archivePreloadTarget: target,
    } as ReaderPage["content"] & { archivePreloadTarget: ArchivePreloadDemandTarget },
  }))
}

function plan(generation: number, candidates: readonly { tier: "near" | "ahead" | "background"; pageIds: readonly string[] }[]): ReaderPreloadPlan {
  return {
    generation,
    frameGeneration: generation,
    direction: "forward",
    directionConfidence: 1,
    mode: "paged",
    admission: "normal",
    velocityPagesPerSecond: 0,
    stableForMs: 500,
    focused: true,
    queueWaitMs: 0,
    memoryPressure: "normal",
    currentPageIndexes: [0],
    candidates: candidates.map((candidate, index) => ({
      tier: candidate.tier,
      priority: candidate.tier === "near" ? "view" : candidate.tier === "ahead" ? "ahead" : "background",
      anchorPageIndex: index + 1,
      pageIndexes: candidate.pageIds.map((_, pageIndex) => pageIndex + 1),
      pageIds: candidate.pageIds,
    })),
  }
}
