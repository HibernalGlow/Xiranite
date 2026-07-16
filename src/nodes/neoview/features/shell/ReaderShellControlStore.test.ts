import { describe, expect, it, vi } from "vitest"

import { createReaderShellControlStore } from "./ReaderShellControlStore"

describe("ReaderShellControlStore", () => {
  it("keeps a stable snapshot until an action changes state", () => {
    const store = createReaderShellControlStore()
    const listener = vi.fn()
    store.subscribe(listener)
    const initial = store.getSnapshot()

    store.requestOpen("left", false)
    expect(store.getSnapshot()).toBe(initial)
    expect(listener).not.toHaveBeenCalled()

    store.requestOpen("left", true)
    expect(store.getSnapshot()).not.toBe(initial)
    expect(store.getSnapshot().edges.left.open).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("hydrates untouched state but does not overwrite user-touched edges or floating control", () => {
    const store = createReaderShellControlStore()
    store.requestOpen("left", true)
    store.setPosition({ x: 20, y: 30 })

    store.hydrate({
      edges: {
        left: { open: false, pinned: true },
        right: { open: true, pinned: true },
      },
      floating: { enabled: false, position: { x: 400, y: 500 } },
    })

    expect(store.getSnapshot().edges.left).toEqual({ open: true, pinned: false, lockMode: "auto" })
    expect(store.getSnapshot().edges.right).toEqual({ open: true, pinned: true, lockMode: "auto" })
    expect(store.getSnapshot().floating).toEqual({ enabled: true, position: { x: 20, y: 30 } })
    expect(store.getTouchedSnapshot()).toEqual({
      edges: { top: false, right: false, bottom: false, left: true },
      floating: true,
    })
  })

  it("replaces a complete confirmed snapshot once while preserving touched markers", () => {
    const store = createReaderShellControlStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.requestOpen("left", true)
    listener.mockClear()

    const confirmed = {
      ...store.getSnapshot(),
      edges: {
        ...store.getSnapshot().edges,
        left: { open: false, pinned: false, lockMode: "auto" as const },
        right: { open: false, pinned: false, lockMode: "locked-hidden" as const },
      },
    }
    store.replace(confirmed)

    expect(store.getSnapshot().edges.left.open).toBe(false)
    expect(store.getSnapshot().edges.right.lockMode).toBe("locked-hidden")
    expect(store.getTouchedSnapshot().edges.left).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    store.replace(confirmed)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("cycles auto, locked-open, locked-closed and back to auto atomically", () => {
    const store = createReaderShellControlStore()

    store.cycleLock("right")
    expect(store.getSnapshot().edges.right).toEqual({ open: true, pinned: true, lockMode: "locked-open" })

    store.cycleLock("right")
    expect(store.getSnapshot().edges.right).toEqual({ open: false, pinned: false, lockMode: "locked-hidden" })

    store.cycleLock("right")
    expect(store.getSnapshot().edges.right).toEqual({ open: false, pinned: false, lockMode: "auto" })
  })

  it("unlocks locked-hidden on an open request and keeps locked-open or pinned edges visible", () => {
    const store = createReaderShellControlStore()
    store.setLock("top", "locked-hidden")
    store.requestOpen("top", true)
    expect(store.getSnapshot().edges.top).toEqual({ open: true, pinned: false, lockMode: "auto" })

    store.setLock("top", "locked-open")
    store.requestOpen("top", false)
    expect(store.getSnapshot().edges.top).toEqual({ open: true, pinned: true, lockMode: "locked-open" })

    store.setLock("top", "auto")
    store.setPinned("top", true)
    store.requestOpen("top", false)
    expect(store.getSnapshot().edges.top).toEqual({ open: true, pinned: true, lockMode: "auto" })
  })

  it("clears lock intent on explicit pin changes and publishes floating changes once", () => {
    const store = createReaderShellControlStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.setLock("bottom", "locked-hidden")
    store.setPinned("bottom", true)
    expect(store.getSnapshot().edges.bottom).toEqual({ open: true, pinned: true, lockMode: "auto" })

    store.setFloating({ enabled: false })
    store.setPosition({ x: 70, y: 80 })
    expect(store.getSnapshot().floating).toEqual({ enabled: false, position: { x: 70, y: 80 } })
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it("closes immediately when an edge returns from pinned to automatic hover", () => {
    const store = createReaderShellControlStore({ edges: { left: { open: true, pinned: true } } })

    store.setPinned("left", false)

    expect(store.getSnapshot().edges.left).toEqual({ open: false, pinned: false, lockMode: "auto" })
  })
})
