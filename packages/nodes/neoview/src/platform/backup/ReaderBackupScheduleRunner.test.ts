import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderBackupInspection } from "./ReaderBackupBundleService.js"
import { ReaderBackupScheduleRunner, type ReaderBackupSchedulePort } from "./ReaderBackupScheduleRunner.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("ReaderBackupScheduleRunner", () => {
  it("[neoview.settings.backup-schedule] creates due backups once, then retains only verified automatic bundles", async () => {
    const root = await temporaryRoot()
    let now = 100
    const port = fakeBackupPort(() => now)
    const runner = new ReaderBackupScheduleRunner({ enabled: true, directory: root, intervalHours: 6, retainCount: 1 }, port, { now: () => now })

    await expect(runner.runIfDue()).resolves.toMatchObject({ status: "created", createdAt: 100, pruned: 0 })
    await expect(runner.runIfDue()).resolves.toMatchObject({ status: "not-due", lastBackupAt: 100, dueAt: 21_600_100 })

    const manual = join(root, "xiranite-neoview-auto-manual")
    await mkdir(manual)
    await writeFile(join(manual, ".xiranite-neoview-auto-backup.json"), JSON.stringify({
      format: "Xiranite/NeoViewAutoBackup", version: 1, createdAt: 1,
    }))
    now += 21_600_000
    await expect(runner.runIfDue()).resolves.toMatchObject({ status: "created", createdAt: now, pruned: 1 })
    await expect(readFile(join(manual, ".xiranite-neoview-auto-backup.json"), "utf8")).resolves.toContain("createdAt")
    expect(port.create).toHaveBeenCalledTimes(2)
  })

  it("[neoview.settings.backup-schedule-lock] skips a concurrent task without deleting its lock", async () => {
    const root = await temporaryRoot()
    let releaseCreate: (() => void) | undefined
    const createGate = new Promise<void>((resolve) => { releaseCreate = resolve })
    const port = fakeBackupPort(() => 100, createGate)
    const runner = new ReaderBackupScheduleRunner({ enabled: true, directory: root, intervalHours: 6, retainCount: 2 }, port, { now: () => 100 })
    const first = runner.runIfDue()
    await vi.waitFor(() => expect(port.create).toHaveBeenCalledOnce())
    await expect(runner.runIfDue()).resolves.toEqual({ status: "locked" })
    releaseCreate!()
    await expect(first).resolves.toMatchObject({ status: "created" })
  })

  it("[neoview.settings.backup-schedule-disabled] does not touch the filesystem while disabled", async () => {
    const port = fakeBackupPort(() => 100)
    const runner = new ReaderBackupScheduleRunner({ enabled: false, intervalHours: 24, retainCount: 7 }, port)
    await expect(runner.runIfDue()).resolves.toEqual({ status: "disabled" })
    expect(port.create).not.toHaveBeenCalled()
  })
})

function fakeBackupPort(now: () => number, createGate?: Promise<void>): ReaderBackupSchedulePort & { create: ReturnType<typeof vi.fn> } {
  const createdAt = new Map<string, number>()
  const create = vi.fn(async (destinationPath: string) => {
    await createGate
    createdAt.set(destinationPath, now())
    await mkdir(destinationPath, { recursive: false })
    return { destinationPath }
  })
  return {
    create,
    inspect: vi.fn(async (bundlePath: string) => inspection(bundlePath, createdAt.get(bundlePath)!)),
  }
}

function inspection(bundlePath: string, createdAt: number): ReaderBackupInspection {
  if (!Number.isSafeInteger(createdAt)) throw new Error("unverified backup")
  return {
    bundlePath,
    manifest: {
      format: "Xiranite/NeoViewBackup",
      version: 1,
      createdAt,
      settings: { name: "settings.json", bytes: 1, sha256: "a".repeat(64), format: "Xiranite/NeoViewConfig", version: 1, omittedSensitivePaths: [] },
      database: { name: "thumbnails.db", bytes: 1, sha256: "b".repeat(64), compatibility: "current", quickCheck: "ok" },
    },
    settings: { format: "Xiranite/NeoViewConfig", version: 1, exportedAt: createdAt, nodeConfig: {}, omittedSensitivePaths: [] },
    database: { sourcePath: bundlePath, verifiedPath: bundlePath, bytes: 1, compatibility: "current", quickCheck: "ok" },
  }
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-scheduled-backup-"))
  roots.push(root)
  return root
}
