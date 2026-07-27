// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_NEOVIEW_SHELL_CONFIG } from "@xiranite/node-neoview/ui-core"

import { useReaderWorkspaceRestoreStore } from "./ReaderWorkspaceRestoreStore"

beforeEach(() => {
  localStorage.clear()
  useReaderWorkspaceRestoreStore.getState().resetRestore()
})

describe("ReaderWorkspaceRestoreStore", () => {
  it("persists Reader view fullscreen independently from swimlane fullscreen", () => {
    useReaderWorkspaceRestoreStore.getState().patchRestore({
      lastSoloLaneId: "reader",
      readerViewFullscreen: true,
    })

    expect(useReaderWorkspaceRestoreStore.getState()).toMatchObject({
      lastSoloLaneId: "reader",
      readerViewFullscreen: true,
    })
    const persisted = JSON.parse(localStorage.getItem("xiranite-neoview-reader-workspace-restore") ?? "{}")
    expect(persisted.state).toEqual({ lastSoloLaneId: "reader", readerViewFullscreen: true })
  })

  it("persists and rehydrates the last validated shell snapshot", async () => {
    const cached = structuredClone(DEFAULT_NEOVIEW_SHELL_CONFIG)
    cached.workspace.mode = "edges"
    cached.sidebars.right.width = 463
    useReaderWorkspaceRestoreStore.getState().cacheShellSnapshot(cached)
    const persisted = localStorage.getItem("xiranite-neoview-reader-workspace-restore")!

    useReaderWorkspaceRestoreStore.setState({ shellSnapshot: undefined })
    localStorage.setItem("xiranite-neoview-reader-workspace-restore", persisted)
    await useReaderWorkspaceRestoreStore.persist.rehydrate()

    expect(useReaderWorkspaceRestoreStore.getState().shellSnapshot).toMatchObject({
      workspace: { mode: "edges" },
      sidebars: { right: { width: 463 } },
    })
  })

  it("retains version-one fullscreen preferences while adding an empty shell cache", async () => {
    localStorage.setItem("xiranite-neoview-reader-workspace-restore", JSON.stringify({
      version: 1,
      state: { lastSoloLaneId: "right", readerViewFullscreen: true },
    }))

    await useReaderWorkspaceRestoreStore.persist.rehydrate()

    expect(useReaderWorkspaceRestoreStore.getState()).toMatchObject({
      lastSoloLaneId: "right",
      readerViewFullscreen: true,
      shellSnapshot: undefined,
    })
  })

  it("keeps the in-memory cache usable when local storage rejects writes", () => {
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota exceeded") })
    const cached = structuredClone(DEFAULT_NEOVIEW_SHELL_CONFIG)

    expect(() => useReaderWorkspaceRestoreStore.getState().cacheShellSnapshot(cached)).not.toThrow()
    expect(useReaderWorkspaceRestoreStore.getState().shellSnapshot).toMatchObject({ workspace: cached.workspace })
    write.mockRestore()
  })
})
