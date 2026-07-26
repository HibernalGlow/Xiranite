import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createMemoryNodeRunHistoryRepository } from "@xiranite/repository"
import { NodeRunHistoryService } from "@xiranite/services"
import { NodeAppOperationRecoveryStore } from "./nodeAppOperationRecovery.js"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => await rm(root, { force: true, recursive: true })))
})

describe("NodeAppOperationRecoveryStore", () => {
  it("writes interrupted work to history without replaying it", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-node-app-operations-"))
    temporaryRoots.push(root)
    const store = new NodeAppOperationRecoveryStore("xlchemy", join(root, "active-operations.json"))
    const repository = createMemoryNodeRunHistoryRepository()
    const history = new NodeRunHistoryService({ repository, createId: () => "interrupted-history" })

    await store.track({ operationId: "op-1", nodeId: "xlchemy", phase: "running", createdAt: 100, startedAt: 110, updatedAt: 120, eventCount: 3 })
    await expect(store.recoverInterrupted(history)).resolves.toBe(1)

    await expect(history.list({ nodeId: "xlchemy" })).resolves.toMatchObject({
      items: [{ id: "interrupted-history", status: "error", message: expect.stringContaining("not replayed") }],
    })
    await expect(store.recoverInterrupted(history)).resolves.toBe(0)
  })
})
