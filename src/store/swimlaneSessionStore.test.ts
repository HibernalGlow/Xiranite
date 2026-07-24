// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest"

import { useSwimlaneSessionStore } from "./swimlaneSessionStore"

beforeEach(() => {
  localStorage.clear()
  useSwimlaneSessionStore.getState().clearSessions()
})

describe("swimlaneSessionStore", () => {
  it("keeps independent session state for each workspace scope", () => {
    const store = useSwimlaneSessionStore.getState()
    store.patchSession("workspace:a", { activeLaneId: "left", soloLaneId: "left" })
    store.patchSession("workspace:b", { activeLaneId: "right", soloLaneId: null })

    expect(useSwimlaneSessionStore.getState().sessions).toEqual({
      "workspace:a": { activeLaneId: "left", soloLaneId: "left" },
      "workspace:b": { activeLaneId: "right", soloLaneId: null },
    })
    expect(localStorage.getItem("xiranite-swimlane-session")).toContain("workspace:a")
  })

  it("only applies a legacy fallback when a scope has no session", () => {
    const store = useSwimlaneSessionStore.getState()
    store.ensureSession("workspace:a", { activeLaneId: "legacy", soloLaneId: "legacy" })
    store.ensureSession("workspace:a", { activeLaneId: "replacement", soloLaneId: null })

    expect(useSwimlaneSessionStore.getState().sessions["workspace:a"]).toEqual({
      activeLaneId: "legacy",
      soloLaneId: "legacy",
    })
  })

  it("persists only soloLaneId so a prior exit-fullscreen survives cold start", () => {
    useSwimlaneSessionStore.getState().patchSession("neoview:reader", { activeLaneId: "right", soloLaneId: null })
    const persisted = JSON.parse(localStorage.getItem("xiranite-swimlane-session") ?? "{}")
    const persistedSessions = persisted.state?.sessions ?? persisted.sessions ?? {}
    expect(persistedSessions["neoview:reader"]).toEqual({ soloLaneId: null })
  })

  it("rehydrates soloLaneId before ensureSession fallback is applied", async () => {
    localStorage.setItem(
      "xiranite-swimlane-session",
      JSON.stringify({ state: { sessions: { "neoview:reader": { soloLaneId: null } } }, version: 1 }),
    )
    const rehydratePromise = useSwimlaneSessionStore.persist.rehydrate()
    const synced = useSwimlaneSessionStore.getState().sessions["neoview:reader"]?.soloLaneId
    const isSync = synced !== undefined
    useSwimlaneSessionStore.getState().ensureSession("neoview:reader", { activeLaneId: "reader", soloLaneId: "reader" })
    if (isSync) {
      expect(useSwimlaneSessionStore.getState().sessions["neoview:reader"]?.soloLaneId).toBeNull()
    } else {
      expect(useSwimlaneSessionStore.getState().sessions["neoview:reader"]?.soloLaneId).toBe("reader")
      await rehydratePromise
      expect(useSwimlaneSessionStore.getState().sessions["neoview:reader"]?.soloLaneId).toBeNull()
    }
  })
})
