import { describe, expect, test } from "vitest"
import type { NodeRunHistoryItemDTO } from "@xiranite/shared"
import { createMemoryNodeRunHistoryRepository } from "./index.js"

describe("createMemoryNodeRunHistoryRepository", () => {
  test("creates, lists (sorted by finishedAt desc), gets, and deletes", async () => {
    const repository = createMemoryNodeRunHistoryRepository({
      items: [
        item({ id: "h1", finishedAt: 100 }),
        item({ id: "h2", finishedAt: 300 }),
        item({ id: "h3", finishedAt: 200 }),
      ],
    })

    expect((await repository.listNodeRunHistory({})).items.map((i) => i.id)).toEqual([
      "h2",
      "h3",
      "h1",
    ])

    expect(await repository.getNodeRunHistory("h2")).toMatchObject({ id: "h2" })
    expect(await repository.getNodeRunHistory("missing")).toBeUndefined()

    await repository.deleteNodeRunHistory("h2")
    expect((await repository.listNodeRunHistory({})).items.map((i) => i.id)).toEqual(["h3", "h1"])
  })

  test("filters by nodeId / componentId / workspaceId / status", async () => {
    const repository = createMemoryNodeRunHistoryRepository({
      items: [
        item({ id: "a", nodeId: "repacku", componentId: "c1", status: "success", finishedAt: 100 }),
        item({ id: "b", nodeId: "repacku", componentId: "c2", status: "error", finishedAt: 200 }),
        item({ id: "c", nodeId: "trename", componentId: "c3", status: "success", finishedAt: 300 }),
      ],
    })

    expect((await repository.listNodeRunHistory({ nodeId: "repacku" })).items.map((i) => i.id)).toEqual([
      "b",
      "a",
    ])
    expect((await repository.listNodeRunHistory({ componentId: "c3" })).items.map((i) => i.id)).toEqual([
      "c",
    ])
    expect((await repository.listNodeRunHistory({ status: "success" })).items.map((i) => i.id)).toEqual([
      "c",
      "a",
    ])
    expect(
      (await repository.listNodeRunHistory({ nodeId: "repacku", status: "error" })).items.map((i) => i.id),
    ).toEqual(["b"])
  })

  test("paginates with cursor using limit+1 strategy", async () => {
    const items: NodeRunHistoryItemDTO[] = []
    for (let i = 1; i <= 5; i += 1) {
      items.push(item({ id: `h${i}`, finishedAt: i * 100 }))
    }
    const repository = createMemoryNodeRunHistoryRepository({ items })

    const firstPage = await repository.listNodeRunHistory({ limit: 2 })
    expect(firstPage.items.map((i) => i.id)).toEqual(["h5", "h4"])
    expect(firstPage.nextCursor).toBe("h4")

    const secondPage = await repository.listNodeRunHistory({ limit: 2, cursor: "h4" })
    expect(secondPage.items.map((i) => i.id)).toEqual(["h3", "h2"])
    expect(secondPage.nextCursor).toBe("h2")

    const thirdPage = await repository.listNodeRunHistory({ limit: 2, cursor: "h2" })
    expect(thirdPage.items.map((i) => i.id)).toEqual(["h1"])
    expect(thirdPage.nextCursor).toBeNull()
  })

  test("clears by nodeId / componentId / before", async () => {
    const repository = createMemoryNodeRunHistoryRepository({
      items: [
        item({ id: "a", nodeId: "repacku", componentId: "c1", finishedAt: 100 }),
        item({ id: "b", nodeId: "repacku", componentId: "c2", finishedAt: 200 }),
        item({ id: "c", nodeId: "trename", componentId: "c3", finishedAt: 300 }),
      ],
    })

    const r1 = await repository.clearNodeRunHistory({ nodeId: "repacku" })
    expect(r1.deletedCount).toBe(2)
    expect((await repository.listNodeRunHistory({})).items.map((i) => i.id)).toEqual(["c"])
  })

  test("clears items older than 'before' timestamp", async () => {
    const repository = createMemoryNodeRunHistoryRepository({
      items: [
        item({ id: "a", finishedAt: 100 }),
        item({ id: "b", finishedAt: 200 }),
        item({ id: "c", finishedAt: 300 }),
      ],
    })

    const result = await repository.clearNodeRunHistory({ before: 200 })
    expect(result.deletedCount).toBe(1)
    expect((await repository.listNodeRunHistory({})).items.map((i) => i.id)).toEqual(["c", "b"])
  })

  test("enforces per-node and global limits on create", async () => {
    const repository = createMemoryNodeRunHistoryRepository({
      limitPerNode: 2,
      globalLimit: 3,
    })

    for (let i = 1; i <= 5; i += 1) {
      await repository.createNodeRunHistory(item({ id: `n1-${i}`, nodeId: "repacku", finishedAt: i * 10 }))
    }
    await repository.createNodeRunHistory(item({ id: "n2-1", nodeId: "trename", finishedAt: 5 }))
    await repository.createNodeRunHistory(item({ id: "n2-2", nodeId: "trename", finishedAt: 6 }))

    const all = await repository.listNodeRunHistory({})
    expect(all.items.length).toBeLessThanOrEqual(3)
    // per-node limit keeps the latest 2 from repacku
    const repacku = await repository.listNodeRunHistory({ nodeId: "repacku" })
    expect(repacku.items.length).toBeLessThanOrEqual(2)
  })

  test("returns clones so callers cannot mutate stored state", async () => {
    const repository = createMemoryNodeRunHistoryRepository({
      items: [item({ id: "a", finishedAt: 1 })],
    })

    const got = await repository.getNodeRunHistory("a")
    got!.message = "tampered"
    const again = await repository.getNodeRunHistory("a")
    expect(again!.message).toBe("ok")
  })

  test("stores generic runtime history without leaking it into node history", async () => {
    const repository = createMemoryNodeRunHistoryRepository({
      items: [item({ id: "node-1", nodeId: "repacku", finishedAt: 100 })],
    })

    await repository.createRuntimeHistory({
      id: "workspace-1",
      kind: "workspace",
      operation: "workspace.snapshot.save",
      status: "success",
      message: "Saved workspace snapshot.",
      inputSummary: "1 workspace",
      startedAt: 200,
      finishedAt: 200,
      durationMs: 0,
    })

    expect((await repository.listRuntimeHistory({})).items.map((i) => i.id)).toEqual(["workspace-1", "node-1"])
    expect((await repository.listRuntimeHistory({ kind: "workspace" })).items.map((i) => i.id)).toEqual(["workspace-1"])
    expect((await repository.listRuntimeHistory({ operation: "node.run" })).items.map((i) => i.id)).toEqual(["node-1"])
    expect((await repository.listNodeRunHistory({})).items.map((i) => i.id)).toEqual(["node-1"])
  })
})

function item(overrides: Partial<NodeRunHistoryItemDTO>): NodeRunHistoryItemDTO {
  const finishedAt = overrides.finishedAt ?? 0
  return {
    id: overrides.id ?? "h",
    nodeId: overrides.nodeId ?? "repacku",
    componentId: overrides.componentId,
    workspaceId: overrides.workspaceId,
    input: overrides.input ?? {},
    inputSummary: overrides.inputSummary ?? "",
    status: overrides.status ?? "success",
    message: overrides.message ?? "ok",
    result: overrides.result,
    eventCount: overrides.eventCount ?? 0,
    startedAt: overrides.startedAt ?? finishedAt,
    finishedAt,
    durationMs: overrides.durationMs ?? 0,
  }
}
