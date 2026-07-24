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
    // soloLaneId:null（退出全屏）跨会话保留；activeLaneId 不持久化，冷启动回到 TOML 默认。
    expect(persistedSessions["neoview:reader"]).toEqual({ soloLaneId: null })
  })
})
