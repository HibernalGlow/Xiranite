/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { describe, expect, test } from "bun:test"
import { act } from "react"
import type { WorkspaceSnapshotDTO } from "@xiranite/shared"
import { XiraniteTui } from "./Tui.js"

describe("Xiranite fullscreen terminal workspace", () => {
  test("deploys and resizes a node with mouse controls through the shared snapshot", async () => {
    let saved: WorkspaceSnapshotDTO | undefined
    const initial: WorkspaceSnapshotDTO = { workspaces: [{ id: "ws", label: "主工作区", createdAt: 1, updatedAt: 1 }], lanes: [], components: [] }
    const taskQueue = { available: false, list: async () => [], pause: async () => {}, resume: async () => {}, cancel: async () => {}, run: async () => ({}) }
    let setup!: Awaited<ReturnType<typeof testRender>>
    await act(async () => { setup = await testRender(<XiraniteTui nodes={[{ id: "sleept", packageName: "@xiranite/node-sleept", bin: "xsleept", description: "系统计时器" }]} workspace={{ available: true, load: async () => initial, save: async (snapshot) => { saved = snapshot } }} taskQueue={taskQueue} onOpenNode={() => undefined} onExit={() => undefined} />, { width: 130, height: 36, useMouse: true }) })
    try {
      await act(async () => setup.renderOnce())
      await setup.waitFor(() => setup.renderer.root.findDescendantById("library-sleept") !== undefined)
      await click(setup, "library-sleept")
      await setup.waitFor(() => saved?.components.length === 1)
      const componentId = saved!.components[0]!.id
      await click(setup, `deployed-${componentId}`)
      await click(setup, "width-plus")
      await setup.waitFor(() => saved?.components[0]?.bentoLayout?.w === 5)
      expect(setup.renderer.root.findDescendantById("global-queue")).toBeDefined()
    } finally { await act(async () => setup.renderer.destroy()) }
  })

  test("operates the shared swimlane model with termcn and OpenTUI controls", async () => {
    let saved: WorkspaceSnapshotDTO | undefined
    const initial: WorkspaceSnapshotDTO = {
      workspaces: [{ id: "ws", label: "主工作区", createdAt: 1, updatedAt: 1 }],
      lanes: [
        { id: "left", workspaceId: "ws", label: "来源", widthRatio: 1, collapsed: false, cardOrder: [], createdAt: 1, updatedAt: 1 },
        { id: "main", workspaceId: "ws", label: "主泳道", widthRatio: 2, collapsed: false, cardOrder: ["node"], createdAt: 2, updatedAt: 2 },
      ],
      components: [{ id: "node", moduleId: "sleept", workspaceId: "ws", laneId: "main", createdAt: 2, updatedAt: 2 }],
    }
    const taskQueue = { available: false, list: async () => [], pause: async () => {}, resume: async () => {}, cancel: async () => {}, run: async () => ({}) }
    let setup!: Awaited<ReturnType<typeof testRender>>
    await act(async () => { setup = await testRender(<XiraniteTui nodes={[]} workspace={{ available: true, load: async () => initial, save: async (snapshot) => { saved = snapshot } }} taskQueue={taskQueue} onOpenNode={() => undefined} onExit={() => undefined} />, { width: 150, height: 42, useMouse: true }) })
    try {
      await act(async () => setup.renderOnce())
      await setup.waitFor(() => setup.renderer.root.findDescendantById("lane-focus-main") !== undefined)
      await click(setup, "lane-focus-main")
      await click(setup, "lane-width-plus")
      await setup.waitFor(() => saved?.lanes.find((lane) => lane.id === "main")?.widthRatio === 2.25)
      await click(setup, "lane-previous")
      await setup.waitFor(() => saved?.lanes.filter((lane) => lane.workspaceId === "ws").map((lane) => lane.id).join(",") === "main,left")
      await click(setup, "lane-collapse")
      await setup.waitFor(() => saved?.lanes.find((lane) => lane.id === "main")?.collapsed === true)
      await click(setup, "lane-solo")
      await setup.waitFor(() => setup.renderer.root.findDescendantById("lane-focus-left") === undefined)
      await click(setup, "lane-solo")
      await click(setup, "lane-navigator-dock-right")
      expect(setup.renderer.root.findDescendantById("lane-navigator-reset")).toBeDefined()
      await click(setup, "lane-navigator-reset")
      expect(setup.renderer.root.findDescendantById("lane-navigator-dock-floating")).toBeDefined()
    } finally { await act(async () => setup.renderer.destroy()) }
  })
})

async function click(setup: Awaited<ReturnType<typeof testRender>>, id: string) {
  const target = setup.renderer.root.findDescendantById(id)
  expect(target).toBeDefined()
  await act(async () => setup.mockMouse.click(target!.x + 1, target!.y + Math.max(0, Math.floor(target!.height / 2))))
  await act(async () => setup.flush())
}
