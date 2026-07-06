import { describe, expect, test } from "bun:test"
import type { WorkspaceRepository } from "@xiranite/repository"
import { WorkspaceService } from "./index.js"

describe("WorkspaceService", () => {
  test("creates and renames workspaces through the repository contract", async () => {
    const repository = memoryRepository()
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
})

function memoryRepository(): WorkspaceRepository {
  const workspaces = new Map<string, Awaited<ReturnType<WorkspaceRepository["listWorkspaces"]>>[number]>()

  return {
    async listWorkspaces() {
      return [...workspaces.values()]
    },
    async createWorkspace(workspace) {
      workspaces.set(workspace.id, workspace)
      return workspace
    },
    async renameWorkspace(id, label, updatedAt) {
      const workspace = workspaces.get(id)
      if (!workspace) throw new Error(`Workspace not found: ${id}`)
      const next = { ...workspace, label, updatedAt }
      workspaces.set(id, next)
      return next
    },
    async deleteWorkspace(id) {
      workspaces.delete(id)
    },
    async listLanes() {
      return []
    },
    async listComponents() {
      return []
    },
  }
}

function fixedClock(values: number[]) {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)]!
}
