import { describe, expect, test } from "vitest"
import type { WorkspaceSnapshotDTO } from "@xiranite/shared"
import { activateTerminalSwimlane, createTerminalSwimlaneState, deployNode, focusAdjacentTerminalSwimlane, moveWorkspaceLane, patchNodeLayout, patchWorkspaceLane, projectTerminalLayout, projectTerminalSwimlanes, removeNode, resetTerminalSwimlaneNavigator, toggleTerminalSwimlaneSolo } from "./workspace-tui-model.js"

const empty: WorkspaceSnapshotDTO = {
  workspaces: [{ id: "ws", label: "Workspace", createdAt: 1, updatedAt: 1 }],
  lanes: [],
  components: [],
}

describe("Xiranite TUI shared workspace model", () => {
  test("deploys, moves, resizes, projects, and removes using the Web bento layout schema", () => {
    const deployed = deployNode(empty, "ws", "sleept", 100)
    const changed = patchNodeLayout(deployed.snapshot, deployed.componentId, { x: 11, y: 3, w: 6, h: 7 }, 110)
    const component = changed.components[0]!
    expect(component.bentoLayout).toEqual({ x: 6, y: 3, w: 6, h: 7 })
    expect(projectTerminalLayout(changed.components, 72)[0]).toMatchObject({ moduleId: "sleept", terminalWidth: 36, terminalHeight: 7 })
    expect(removeNode(changed, deployed.componentId).components).toEqual([])
  })

  test("projects and mutates terminal lanes through the shared swimlane state machine", () => {
    const snapshot: WorkspaceSnapshotDTO = {
      ...empty,
      lanes: [
        { id: "left", workspaceId: "ws", label: "Left", widthRatio: 1, collapsed: false, cardOrder: ["a"], createdAt: 1, updatedAt: 1 },
        { id: "main", workspaceId: "ws", label: "Main", widthRatio: 2, collapsed: false, cardOrder: ["b"], createdAt: 2, updatedAt: 2 },
      ],
      components: [
        { id: "a", moduleId: "cleanf", workspaceId: "ws", laneId: "left", createdAt: 1, updatedAt: 1 },
        { id: "b", moduleId: "czkawka", workspaceId: "ws", laneId: "main", createdAt: 2, updatedAt: 2 },
      ],
    }
    let state = createTerminalSwimlaneState(snapshot, "ws", { navigatorDock: "right" })
    state = focusAdjacentTerminalSwimlane(state, "right")
    expect(state.activeLaneId).toBe("main")
    state = toggleTerminalSwimlaneSolo(state)
    expect(projectTerminalSwimlanes(snapshot, "ws", 90, state)).toMatchObject([{ id: "main", solo: true, terminalWidth: 90, components: [{ id: "b" }] }])
    state = activateTerminalSwimlane(state, "left")
    expect(state).toMatchObject({ activeLaneId: "left", soloLaneId: "main" })
    expect(resetTerminalSwimlaneNavigator(state)).toMatchObject({ navigatorDock: "floating", navigatorVisible: true })

    const resized = patchWorkspaceLane(snapshot, "left", { collapsed: true, widthRatio: 3 }, 10)
    expect(resized.lanes[0]).toMatchObject({ collapsed: true, widthRatio: 3, updatedAt: 10 })
    expect(moveWorkspaceLane(snapshot, "ws", "main", "left", 11).lanes.map((lane) => lane.id)).toEqual(["main", "left"])
  })
})
