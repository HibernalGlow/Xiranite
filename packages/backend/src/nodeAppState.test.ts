import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { NodeAppStateStore, resolveNodeAppStatePath } from "./nodeAppState.js"
import { capturePlatformDataDirEnvironment, redirectPlatformDataDir, restorePlatformDataDirEnvironment } from "./nodeAppDataTestEnvironment.js"

const originalEnvironment = capturePlatformDataDirEnvironment()
const temporaryRoots: string[] = []

afterEach(async () => {
  restorePlatformDataDirEnvironment(originalEnvironment)
  await Promise.all(temporaryRoots.splice(0).map(async (root) => await rm(root, { force: true, recursive: true })))
})

describe("NodeAppStateStore", () => {
  it("inherits the latest compatible state into a new snapshot without mutating the old snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-node-app-state-"))
    temporaryRoots.push(root)
    redirectPlatformDataDir(root)

    const oldSnapshot = new NodeAppStateStore("xlchemy", "old-snapshot")
    await oldSnapshot.patch({ selectedPaths: ["D:/input.png"], quality: 90 })

    const currentSnapshot = new NodeAppStateStore("xlchemy", "current-snapshot")
    await expect(currentSnapshot.get()).resolves.toEqual({ selectedPaths: ["D:/input.png"], quality: 90 })
    await currentSnapshot.patch({ quality: 80 })

    await expect(oldSnapshot.get()).resolves.toEqual({ selectedPaths: ["D:/input.png"], quality: 90 })
    await expect(currentSnapshot.get()).resolves.toEqual({ selectedPaths: ["D:/input.png"], quality: 80 })
    expect(oldSnapshot.path).toBe(resolveNodeAppStatePath("xlchemy", "old-snapshot"))
    expect(currentSnapshot.path).not.toBe(oldSnapshot.path)
  })

  it("keeps an inherited legacy snapshot untouched when the new snapshot is reset", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-node-app-state-"))
    temporaryRoots.push(root)
    redirectPlatformDataDir(root)

    const oldSnapshot = new NodeAppStateStore("xlchemy", "old-snapshot")
    await oldSnapshot.patch({ quality: "invalid" })

    const currentSnapshot = new NodeAppStateStore("xlchemy", "current-snapshot")
    await expect(currentSnapshot.get()).resolves.toEqual({ quality: "invalid" })
    await currentSnapshot.replace({})

    await expect(oldSnapshot.get()).resolves.toEqual({ quality: "invalid" })
    await expect(currentSnapshot.get()).resolves.toEqual({})
  })
})
