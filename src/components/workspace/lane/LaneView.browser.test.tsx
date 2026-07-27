import { afterEach, beforeEach, expect, test } from "vitest"
import { cleanup, render } from "vitest-browser-react"

import { INITIAL_STATE } from "@/store/workspace/constants"
import { useSwimlaneSessionStore } from "@/store/swimlaneSessionStore"
import { useWorkspaceStore } from "@/store/workspaceStore"
import { LaneView } from "./LaneView"

beforeEach(() => {
  useSwimlaneSessionStore.getState().clearSessions()
  useWorkspaceStore.setState({
    ...INITIAL_STATE,
    activeWorkspaceId: "lane-scrollbar-test",
    viewMode: "lane",
    workspaces: [{ id: "lane-scrollbar-test", label: "Scrollbar test" }],
    lanes: [
      { id: "lane-a", workspaceId: "lane-scrollbar-test", label: "Alpha", widthRatio: 1, collapsed: false, cardOrder: [] },
      { id: "lane-b", workspaceId: "lane-scrollbar-test", label: "Beta", widthRatio: 1, collapsed: false, cardOrder: [] },
    ],
    components: [],
    laneWorkspacePreferences: {},
  })
})

afterEach(() => {
  cleanup()
  useSwimlaneSessionStore.getState().clearSessions()
  useWorkspaceStore.setState({ ...INITIAL_STATE })
})

test("hides project swimlane scrollbar rails while preserving both scroll containers", async () => {
  await render(<LaneView />)

  const horizontalViewport = document.querySelector<HTMLElement>('[data-lane-board="true"]')!.parentElement!
  const verticalViewport = document.querySelector<HTMLElement>('[data-lane-drop-zone="lane-a"]')!
  expect(getComputedStyle(horizontalViewport).overflowX).toBe("auto")
  expect(getComputedStyle(horizontalViewport).scrollbarWidth).toBe("none")
  expect(getComputedStyle(verticalViewport).overflowY).toBe("auto")
  expect(getComputedStyle(verticalViewport).scrollbarWidth).toBe("none")
})
