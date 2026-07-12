// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { XlchemyData, XlchemyInput } from "@xiranite/node-xlchemy/core"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import { Component } from "./Component"
import type { XlchemyCardState } from "./types"

const surfaceState = vi.hoisted(() => ({ height: 420, width: 720 }))
vi.mock("@/nodes/shared/useNodeSurface", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/nodes/shared/useNodeSurface")>()
  return { ...actual, useNodeSurface: () => { const mode = actual.resolveNodeSurfaceMode(surfaceState); return { ref: { current: null }, ...surfaceState, mode, density: actual.resolveNodeSurfaceDensity(mode) } } }
})

afterEach(() => { cleanup(); vi.clearAllMocks(); setSurface("regular") })

describe("app-owned xlchemy Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)("renders the %s surface", (mode) => {
    setSurface(mode)
    render(<Component compId="xlchemy-card" host={createHost({ pathsText: "D:/images/a.png" })} />)
    expect(screen.getByText("Xlchemy")).toBeTruthy()
    expect(screen.getByTestId(`xlchemy-${mode === "regular" || mode === "expanded" || mode === "workspace" ? "full" : mode}-view`)).toBeTruthy()
    if (mode !== "collapsed") expect(screen.getByLabelText("xlchemy input paths")).toBeTruthy()
    if (mode === "regular" || mode === "expanded" || mode === "workspace") {
      expect(screen.getByRole("tab", { name: "结果" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "问题" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "日志" })).toBeTruthy()
    }
  })

  test("applies a preset and sends a plan to the node runner", async () => {
    const host = createHost({ pathsText: "D:/images/a.png" })
    render(<Component compId="xlchemy-card" host={host} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: /Alpha JPEG XL/ }))
    expect(host.cardState).toMatchObject({ format: "JPEG XL", lossless: true, quality: 100 })
    await user.click(screen.getByRole("button", { name: "预览计划" }))
    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toMatchObject({ nodeId: "xlchemy", input: { action: "plan", paths: ["D:/images/a.png"], lossless: true } })
  })
})

type TestHost = NodeHostApi<XlchemyCardState, Partial<XlchemyCardState>> & { cardState: XlchemyCardState; runCalls: Array<{ nodeId: string; input: XlchemyInput }> }
function createHost(initial: XlchemyCardState): TestHost {
  const host = {
    cardState: { ...initial }, runCalls: [],
    contract: { name: "xiranite.node-host", version: "1.0.0", supportedCapabilities: ["state", "runner", "clipboard", "config"], hasCapability: () => true },
    env: { theme: "light", platform: "web" },
    state: { getData: () => host.cardState, patchData: (patch: Partial<XlchemyCardState>) => { host.cardState = { ...host.cardState, ...patch } } },
    runner: { run: async <TInput, TData>(nodeId: string, input: TInput, onEvent?: (event: NodeRunEvent) => void): Promise<NodeRunResult<TData>> => { host.runCalls.push({ nodeId, input: input as XlchemyInput }); onEvent?.({ type: "progress", progress: 50, message: "Calibrating." }); return { success: true, message: "Planned.", data: result as TData } } },
    clipboard: { readText: async () => "D:/images/a.png", writeText: async () => undefined },
    config: { get: async () => ({ config: undefined, path: "D:/config/xiranite.config.toml" }), save: async () => undefined, openFile: () => undefined },
    getData: <T,>() => host.cardState as T, patchData: (_id: string, patch: Partial<XlchemyCardState>) => host.state.patchData(patch), listComponents: () => [], updateComponent: () => undefined,
  } as unknown as TestHost
  return host
}
function setSurface(mode: NodeSurfaceMode) { Object.assign(surfaceState, NODE_SURFACE_TEST_SPECS[mode]) }
const result: XlchemyData = { files: [], inputCount: 1, convertedCount: 0, skippedCount: 0, errorCount: 0, inputBytes: 0, outputBytes: 0, errors: [] }
