import { beforeEach, describe, expect, it, vi } from "vitest"

import { runNodeOnLocalBackend } from "@/backend/nodeRpcClient"
import { migrateFolderEntryToPickedDirectory, runMigratefToDirectory } from "./FolderMigratefAction"

vi.mock("@/backend/nodeRpcClient", () => ({ runNodeOnLocalBackend: vi.fn() }))

describe("runMigratefToDirectory", () => {
  beforeEach(() => {
    vi.mocked(runNodeOnLocalBackend).mockReset()
  })

  it("[neoview.folder.migratef-direct] delegates one entry move to the registered migratef node", async () => {
    vi.mocked(runNodeOnLocalBackend).mockResolvedValue({ success: true, message: "Moved." })

    await runMigratefToDirectory("D:/library/book.cbz", "E:/archive")

    expect(runNodeOnLocalBackend).toHaveBeenCalledWith("migratef", {
      action: "move",
      mode: "direct",
      sourcePaths: ["D:/library/book.cbz"],
      targetPath: "E:/archive",
      dryRun: false,
      relativeTargetBase: "source-parent",
      mergeExistingDirectories: true,
    })
  })

  it("[neoview.folder.migratef-failure] preserves the shared node failure message", async () => {
    vi.mocked(runNodeOnLocalBackend).mockResolvedValue({ success: false, message: "Target is read-only." })

    await expect(runMigratefToDirectory("D:/library/book.cbz", "E:/archive")).rejects.toThrow("Target is read-only.")
  })

  it("[neoview.folder.migratef-cancel] does not invoke the node when directory selection is cancelled", async () => {
    await expect(migrateFolderEntryToPickedDirectory({
      sourcePath: "D:/library/book.cbz",
      sourceName: "book.cbz",
      pickDirectory: async () => undefined,
    })).resolves.toBeUndefined()

    expect(runNodeOnLocalBackend).not.toHaveBeenCalled()
  })
})
