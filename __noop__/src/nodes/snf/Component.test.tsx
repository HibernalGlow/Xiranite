// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { SnfData, SnfInput } from "@xiranite/node-snf/core"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import { Component } from "./Component"
import { ACTIONS } from "./constants"
import type { SnfCardState } from "./types"

const surfaceState = vi.hoisted(() => ({ height: 420, width: 720 }))

vi.mock("@/nodes/shared/useNodeSurface", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/nodes/shared/useNodeSurface")>()
  return {
    ...actual,
    useNodeSurface: () => {
      const mode = actual.resolveNodeSurfaceMode(surfaceState)
      return { ref: { current: null }, width: surfaceState.width, height: surfaceState.height, mode, density: actual.resolveNodeSurfaceDensity(mode) }
    },
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  setSurface("regular")
})

describe("app-owned snf Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)("renders the %s surface with native SNF UI", (mode) => {
    setSurface(mode)
    render(<Component compId="comp-snf" host={createHost({ pathsText: "D:/archives" })} />)
    expect(screen.getByText("SNF")).toBeTruthy()
    if (mode === "collapsed") {
      expect(screen.getByTestId("snf-collapsed-view")).toBeTruthy()
      expect(screen.queryByLabelText("snf paths")).toBeNull()
      return
    }
    expect(screen.getByLabelText("snf paths")).toBeTruthy()
    expect(screen.getAllByRole("tab")).toHaveLength(3)
    expect(screen.queryByText(/python/i)).toBeNull()
    expect(screen.queryByText(/sourceRoot|moduleName/)).toBeNull()
    if (mode === "compact") expect(screen.getByTestId("snf-compact-view")).toBeTruthy()
    else if (mode === "portrait") expect(screen.getByTestId("snf-portrait-view")).toBeTruthy()
    else {
      expect(screen.getByTestId("snf-full-view")).toBeTruthy()
      expect(screen.getByTestId("snf-header-toolbar")).toBeTruthy()
      expect(screen.getByRole("button", { name: ACTIONS[1]!.label })).toBeTruthy()
    }
  })

  test("runs plan through host.runner.run and stores sequence items", async () => {
    setSurface("regular")
    const host = createHost({ action: "plan", pathsText: "D:/archives", mode: "library", dryRun: true, logs: [] })
    render(<Component compId="comp-snf" host={host} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: ACTIONS[1]!.label }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "snf",
      input: { action: "plan", paths: ["D:/archives"], mode: "library", keepTimestamp: true, dryRun: true },
    })
    await waitFor(() => expect(host.cardState.phase).toBe("completed"))
    expect(host.cardState.result?.items[0]?.targetName).toBe("1. CG")
  })

  test("requires confirmation before live rename execution", async () => {
    setSurface("regular")
    const host = createHost({ action: "rename", pathsText: "D:/archives", dryRun: false, logs: [] })
    render(<Component compId="comp-snf" host={host} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: ACTIONS[2]!.label }))
    expect(host.runCalls).toHaveLength(0)
    const dialog = screen.getByRole("alertdialog")
    await user.click(within(dialog).getByRole("button", { name: "确认执行" }))
    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("rename")
    expect(host.runCalls[0]?.input.dryRun).toBe(false)
  })

  test("marks the card as error when run has no paths", async () => {
    setSurface("regular")
    const host = createHost({ action: "plan", logs: [] })
    render(<Component compId="comp-snf" host={host} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: ACTIONS[1]!.label }))
    expect(host.runCalls).toHaveLength(0)
    await waitFor(() => expect(host.cardState.phase).toBe("error"))
    expect(host.cardState.progressText).toBeTruthy()
  })
})

type TestHost = NodeHostApi<SnfCardState, Partial<SnfCardState>> & {
  copiedText: string
  runCalls: Array<{ nodeId: string; input: SnfInput }>
  savedConfig: Partial<SnfCardState> | undefined
  cardState: SnfCardState
}

function createHost(initial: SnfCardState): TestHost {
  const stateCapability = {
    getData: () => host.cardState,
    patchData: (patch: Partial<SnfCardState>) => { host.cardState = { ...host.cardState, ...patch } },
  }
  const host: TestHost = {
    cardState: { ...initial },
    runCalls: [],
    copiedText: "",
    savedConfig: undefined,
    contract: { name: "xiranite.node-host", version: "1.0.0", supportedCapabilities: ["contract", "state", "runner", "clipboard", "config", "env"], hasCapability: (capability) => ["contract", "state", "runner", "clipboard", "config", "env"].includes(capability) },
    env: { theme: "light", platform: "web" },
    state: stateCapability,
    runner: {
      run: async <TInput, TData>(nodeId: string, input: TInput, onEvent?: (event: NodeRunEvent) => void): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as SnfInput })
        onEvent?.({ type: "progress", progress: 50, message: "Planning sequence items." })
        return { success: true, message: "SNF planned 1 item.", data: snfData as TData }
      },
    },
    clipboard: { readText: async () => "D:/archives", writeText: async (text) => { host.copiedText = text } },
    config: { get: async () => ({ config: undefined, path: "D:/config/xiranite.config.toml" }), save: async (config) => { host.savedConfig = config }, openFile: () => undefined },
    getData: <T,>() => stateCapability.getData() as T | undefined,
    patchData: (_compId, patch) => stateCapability.patchData(patch),
    listComponents: () => [],
    updateComponent: () => undefined,
    actions: undefined,
    getNodeConfig: async <T,>() => ({ config: undefined as T | undefined, path: "D:/config/xiranite.config.toml" }),
    saveNodeConfig: async (config) => { host.savedConfig = config as Partial<SnfCardState> },
    openConfigFile: () => undefined,
  }
  return host
}

function setSurface(mode: NodeSurfaceMode) {
  setSurfaceSize(NODE_SURFACE_TEST_SPECS[mode])
}

function setSurfaceSize(size: { height: number; width: number }) {
  surfaceState.width = size.width
  surfaceState.height = size.height
}

const snfData: SnfData = {
  action: "plan",
  mode: "library",
  items: [{ artistPath: "D:/archives/Artist", sourcePath: "D:/archives/Artist/3. CG", targetPath: "D:/archives/Artist/1. CG", sourceName: "3. CG", targetName: "1. CG", sequence: 1, status: "ready" }],
  artistCount: 1,
  scannedCount: 1,
  readyCount: 1,
  renamedCount: 0,
  unchangedCount: 0,
  skippedCount: 0,
  conflictCount: 0,
  errorCount: 0,
  errors: [],
}
