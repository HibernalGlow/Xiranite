// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest"

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
})
