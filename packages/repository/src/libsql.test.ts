import { describe, expect, test } from "vitest"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { createLibsqlWorkspaceRepository, type LibsqlWorkspaceRepository } from "./libsql.js"

const RUN_ROOT = join(process.cwd(), "artifacts", "test-runs", "repository")

describe("createLibsqlWorkspaceRepository", () => {
  test("persists complete workspace snapshots to a local libSQL file", async () => {
    const tmpRoot = RUN_ROOT
    await mkdir(tmpRoot, { recursive: true })
    const dir = await mkdtemp(join(tmpRoot, "xiranite-libsql-"))
    const clients: LibsqlWorkspaceRepository[] = []
    try {
      const url = pathToFileURL(join(dir, "xiranite.db")).href
      const repository = await createLibsqlWorkspaceRepository({ url })
      clients.push(repository)

      const snapshot = {
        workspaces: [{
          id: "ws-alpha",
          label: "Alpha",
          flowCanvas: { store: { "shape:box": { typeName: "shape", type: "geo" } }, schema: { schemaVersion: 2 } },
          createdAt: 100,
          updatedAt: 100,
        }],
        lanes: [
          {
            id: "lane-alpha",
            label: "Alpha lane",
            workspaceId: "ws-alpha",
            widthRatio: 1.25,
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
            flowPosition: { x: 1, y: 2 },
            flowSize: { width: 384, height: 320 },
            laneId: "lane-alpha",
            hiddenIn: { cards: true },
            tags: ["draft"],
            z: 3,
            collapsed: true,
            createdAt: 100,
            updatedAt: 100,
          },
        ],
      }

      await repository.saveSnapshot(snapshot)
      repository.client.close()
      clients.pop()

      const reopened = await createLibsqlWorkspaceRepository({ url })
      clients.push(reopened)
      await expect(reopened.listWorkspaces()).resolves.toEqual(snapshot.workspaces)
      await expect(reopened.listLanes()).resolves.toEqual(snapshot.lanes)
      await expect(reopened.listComponents()).resolves.toEqual(snapshot.components)
    } finally {
      for (const repository of clients) {
        repository.client.close()
      }
      await removeWithWindowsRetry(dir)
    }
  })

  test("removes stale rows outside the saved workspace set", async () => {
    const tmpRoot = RUN_ROOT
    await mkdir(tmpRoot, { recursive: true })
    const dir = await mkdtemp(join(tmpRoot, "xiranite-libsql-stale-"))
    const repository = await createLibsqlWorkspaceRepository({
      url: pathToFileURL(join(dir, "xiranite.db")).href,
    })
    try {
      await repository.saveSnapshot({
        workspaces: [
          { id: "ws-one", label: "One", createdAt: 100, updatedAt: 100 },
          { id: "ws-two", label: "Two", createdAt: 100, updatedAt: 100 },
        ],
        lanes: [
          { id: "lane-one", label: "One", workspaceId: "ws-one", widthRatio: 1, collapsed: false, createdAt: 100, updatedAt: 100 },
          { id: "lane-two", label: "Two", workspaceId: "ws-two", widthRatio: 1, collapsed: false, createdAt: 100, updatedAt: 100 },
        ],
        components: [
          { id: "comp-one", moduleId: "scratch", workspaceId: "ws-one", createdAt: 100, updatedAt: 100 },
          { id: "comp-two", moduleId: "scratch", workspaceId: "ws-two", createdAt: 100, updatedAt: 100 },
        ],
      })

      await repository.saveSnapshot({
        workspaces: [{ id: "ws-one", label: "One", createdAt: 100, updatedAt: 200 }],
        lanes: [{ id: "lane-one", label: "One", workspaceId: "ws-one", widthRatio: 1, collapsed: false, createdAt: 100, updatedAt: 200 }],
        components: [{ id: "comp-one", moduleId: "scratch", workspaceId: "ws-one", createdAt: 100, updatedAt: 200 }],
      })

      await expect(repository.listWorkspaces()).resolves.toEqual([{ id: "ws-one", label: "One", createdAt: 100, updatedAt: 200 }])
      await expect(repository.listLanes()).resolves.toEqual([{ id: "lane-one", label: "One", workspaceId: "ws-one", widthRatio: 1, collapsed: false, createdAt: 100, updatedAt: 200 }])
      await expect(repository.listComponents()).resolves.toEqual([{ id: "comp-one", moduleId: "scratch", workspaceId: "ws-one", createdAt: 100, updatedAt: 200 }])
    } finally {
      repository.client.close()
      await removeWithWindowsRetry(dir)
    }
  })
})

async function removeWithWindowsRetry(path: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EBUSY" && attempt === 9) return
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error
      await sleep(25)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
