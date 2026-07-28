import { beforeEach, describe, expect, it, vi } from "vitest"

import { runNodeOnLocalBackend } from "@/backend/nodeRpcClient"
import { runDissolvefFolder } from "./FolderDissolvefAction"

vi.mock("@/backend/nodeRpcClient", () => ({ runNodeOnLocalBackend: vi.fn() }))

describe("runDissolvefFolder", () => {
  beforeEach(() => {
    vi.mocked(runNodeOnLocalBackend).mockReset()
  })

  it("[neoview.folder.dissolvef-direct] runs the registered dissolvef node in direct mode", async () => {
    vi.mocked(runNodeOnLocalBackend).mockResolvedValue({ success: true, message: "Dissolved." })

    await runDissolvefFolder("D:/library/series")

    expect(runNodeOnLocalBackend).toHaveBeenCalledWith("dissolvef", {
      action: "direct",
      path: "D:/library/series",
      preview: false,
    })
  })

  it("[neoview.folder.dissolvef-failure] preserves the node failure message", async () => {
    vi.mocked(runNodeOnLocalBackend).mockResolvedValue({ success: false, message: "Folder is locked." })

    await expect(runDissolvefFolder("D:/library/series")).rejects.toThrow("Folder is locked.")
  })
})
