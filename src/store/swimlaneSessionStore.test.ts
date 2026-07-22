// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest"

import { useSwimlaneSessionStore } from "./swimlaneSessionStore"

beforeEach(() => {
  sessionStorage.clear()
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
    expect(sessionStorage.getItem("xiranite-swimlane-session")).toContain("workspace:a")
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
})
