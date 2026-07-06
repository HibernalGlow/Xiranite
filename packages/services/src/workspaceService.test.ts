import { describe, expect, test } from "bun:test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"
import { WorkspaceService } from "./index.js"

describe("WorkspaceService", () => {
  test("creates and renames workspaces through the repository contract", async () => {
    const repository = createMemoryWorkspaceRepository()
    const service = new WorkspaceService({
      repository,
      now: fixedClock([100, 200]),
      createId: () => "alpha",
    })

    const created = await service.createWorkspace({ label: "Alpha" })
    expect(created).toEqual({
      id: "ws-alpha",
      label: "Alpha",
      icon: undefined,
      createdAt: 100,
      updatedAt: 100,
    })

    const renamed = await service.renameWorkspace("ws-alpha", { label: "Beta" })
    expect(renamed.label).toBe("Beta")
    expect(renamed.createdAt).toBe(100)
    expect(renamed.updatedAt).toBe(200)
  })

  test("loads and saves complete workspace snapshots", async () => {
    const snapshot = {
      workspaces: [{ id: "ws-alpha", label: "Alpha", createdAt: 100, updatedAt: 100 }],
      lanes: [
        {
          id: "lane-alpha",
          label: "Alpha lane",
          workspaceId: "ws-alpha",
          widthRatio: 1,
          collapsed: false,
          hidden: false,
          cardOrder: ["comp-alpha"],
          createdAt: 100,
          updatedAt: 100,
        },
      ],
      components: [
        {
          id: "comp-alpha",
          moduleId: "scratch",
          workspaceId: "ws-alpha",
          data: { text: "hello" },
          laneId: "lane-alpha",
          createdAt: 100,
          updatedAt: 100,
        },
      ],
    }
    const repository = createMemoryWorkspaceRepository(snapshot)
    const service = new WorkspaceService({ repository })

    expect(await service.getSnapshot()).toEqual(snapshot)

    const nextSnapshot = { workspaces: [], lanes: [], components: [] }
    expect(await service.saveSnapshot(nextSnapshot)).toEqual(nextSnapshot)
    expect(await service.getSnapshot()).toEqual(nextSnapshot)
  })
})

function fixedClock(values: number[]) {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)]!
}
