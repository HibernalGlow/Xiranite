// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./Lane", () => ({
  Lane: ({ lane, active, solo }: { lane: { id: string; label: string }; active: boolean; solo: boolean }) => <section data-lane-id={lane.id} data-swimlane-active={active} data-swimlane-solo={solo}>{lane.label}</section>,
}))

import { INITIAL_STATE } from "@/store/workspace/constants"
import { useWorkspaceStore } from "@/store/workspaceStore"
import { LaneView } from "./LaneView"

beforeEach(() => {
  useWorkspaceStore.setState({
    ...INITIAL_STATE,
    activeWorkspaceId: "lane-test",
    viewMode: "lane",
    workspaces: [{ id: "lane-test", label: "Test" }],
    lanes: [
      { id: "lane-a", workspaceId: "lane-test", label: "Alpha", widthRatio: 1, collapsed: false, cardOrder: [] },
      { id: "lane-b", workspaceId: "lane-test", label: "Beta", widthRatio: 1, collapsed: false, cardOrder: [] },
    ],
    components: [],
    laneWorkspacePreferences: {},
  })
})

afterEach(() => {
  cleanup()
  useWorkspaceStore.setState({ ...INITIAL_STATE })
})

describe("LaneView shared swimlane framework", () => {
  it("persists focus and restores the active lane in solo mode from the movable bar", () => {
    render(<LaneView />)

    fireEvent.click(screen.getByRole("button", { name: "Beta (0)" }))
    expect(useWorkspaceStore.getState().laneWorkspacePreferences["lane-test"]?.activeLaneId).toBe("lane-b")

    const handle = screen.getByRole("button", { name: "拖动或设置泳道切换栏" })
    fireEvent.contextMenu(handle)
    fireEvent.click(screen.getByRole("menuitem", { name: "当前泳道独占视口" }))

    expect(useWorkspaceStore.getState().laneWorkspacePreferences["lane-test"]?.soloLaneId).toBe("lane-b")
    expect(document.querySelector('[data-lane-id="lane-b"]')?.getAttribute("data-swimlane-solo")).toBe("true")
  })
})
