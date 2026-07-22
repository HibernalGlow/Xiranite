// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./Lane", () => ({
  Lane: ({ lane, active, solo, hideTitleForNavigator, onTitleHostChange }: { lane: { id: string; label: string }; active: boolean; solo: boolean; hideTitleForNavigator?: boolean; onTitleHostChange?(node: HTMLElement | null): void }) => <section data-lane-id={lane.id} data-swimlane-active={active} data-swimlane-solo={solo}><header><span ref={onTitleHostChange}>{hideTitleForNavigator ? null : <span data-lane-title>{lane.label}</span>}</span></header></section>,
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

  it("docks the shared bar into the active lane title and follows focus", () => {
    render(<LaneView />)
    const handle = screen.getByRole("button", { name: "拖动或设置泳道切换栏" })
    fireEvent.contextMenu(handle)
    fireEvent.click(screen.getByRole("menuitem", { name: "固定到当前泳道标题栏" }))

    expect(useWorkspaceStore.getState().laneWorkspacePreferences["lane-test"]?.navigatorDock).toBe("title")
    expect(document.querySelector('[data-lane-id="lane-a"] [data-swimlane-navigator-dock="title"]')).toBeTruthy()
    expect(document.querySelector('[data-lane-id="lane-a"] [data-lane-title]')).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Beta (0)" }))
    expect(document.querySelector('[data-lane-id="lane-b"] [data-swimlane-navigator-dock="title"]')).toBeTruthy()
  })

  it("offers one-shot and persistent proportional viewport fitting", () => {
    render(<LaneView />)
    fireEvent.contextMenu(screen.getByRole("button", { name: "拖动或设置泳道切换栏" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "按当前比例填满视口" }))
    expect(useWorkspaceStore.getState().laneWorkspacePreferences["lane-test"]?.autoFitToViewport).not.toBe(true)

    fireEvent.contextMenu(screen.getByRole("button", { name: "拖动或设置泳道切换栏" }))
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "常驻按比例适应视口" }))
    expect(useWorkspaceStore.getState().laneWorkspacePreferences["lane-test"]?.autoFitToViewport).toBe(true)
  })
})
