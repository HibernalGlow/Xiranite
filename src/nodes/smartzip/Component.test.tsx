// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import type { SmartZipData, SmartZipInput } from "@xiranite/node-smartzip/core"
import { Component } from "./Component"
import type { SmartZipCardState } from "./types"

const surfaceState = vi.hoisted(() => ({
  height: 420,
  width: 720,
}))

vi.mock("@/nodes/shared/useNodeSurface", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/nodes/shared/useNodeSurface")>()
  return {
    ...actual,
    useNodeSurface: () => {
      const mode = actual.resolveNodeSurfaceMode(surfaceState)
      return {
        ref: { current: null },
        width: surfaceState.width,
        height: surfaceState.height,
        mode,
        density: actual.resolveNodeSurfaceDensity(mode),
      }
    },
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  setSurface("regular")
})

describe("app-owned smartzip Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)(
    "renders the %s surface with SmartZip-specific UI",
    (mode) => {
      setSurface(mode)
      render(<Component compId="comp-smartzip" host={createHost({ pathsText: "D:/archives/a.zip" })} />)

      expect(screen.getByText("SmartZip")).toBeTruthy()
      if (mode === "collapsed") {
        expect(screen.getByTestId("smartzip-collapsed-view")).toBeTruthy()
        expect(screen.queryByLabelText("smartzip 归档或目录")).toBeNull()
        return
      }

      expect(screen.getByLabelText("smartzip 归档或目录")).toBeTruthy()
      expect(screen.getByRole("tab", { name: "命令" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "配置" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "日志" })).toBeTruthy()

      if (mode === "compact") {
        expect(screen.getByTestId("smartzip-compact-view")).toBeTruthy()
      } else if (mode === "portrait") {
        expect(screen.getByTestId("smartzip-portrait-view")).toBeTruthy()
      } else {
        expect(screen.getByTestId("smartzip-full-view")).toBeTruthy()
        expect(screen.getByTestId("smartzip-header-toolbar")).toBeTruthy()
        expect(screen.getByText("归档工作台")).toBeTruthy()
        expect(screen.getByTestId("smartzip-action-deck")).toBeTruthy()
        expect(screen.getByRole("button", { name: "解压归档" })).toBeTruthy()
        expect(screen.getByRole("button", { name: "创建归档" })).toBeTruthy()
      }
    },
  )

  test("runs status through host.runner.run and stores config results", async () => {
    setSurface("regular")
    const host = createHost({
      action: "status",
      pathsText: "D:/archives/a.zip",
      dryRun: true,
      logs: [],
    })
    render(<Component compId="comp-smartzip" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "查看状态" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "smartzip",
      input: {
        action: "status",
        codePage: 936,
        paths: ["D:/archives/a.zip"],
        iniPath: undefined,
        databasePath: undefined,
        dryRun: true,
        recordRun: false,
      },
    })
    await waitFor(() => expect(host.cardState.phase).toBe("completed"))
    expect(host.cardState.result?.config.archiveExtensions).toContain("zip")

    await user.click(screen.getByRole("tab", { name: "配置" }))
    expect(screen.getAllByText(/zip/).length).toBeGreaterThanOrEqual(1)
  })

  test("requires confirmation before real extract execution", async () => {
    setSurface("regular")
    const host = createHost({ action: "extract", pathsText: "D:/archives/a.zip", dryRun: false, logs: [] })
    render(<Component compId="comp-smartzip" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "解压归档" }))
    expect(host.runCalls).toHaveLength(0)
    expect(screen.getByText("确认解压归档？")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "确认执行" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("extract")
    expect(host.runCalls[0]?.input.dryRun).toBe(false)
  })

  test("runs a direct action without selecting a mode first", async () => {
    setSurface("regular")
    const host = createHost({ action: "status", pathsText: "D:/archives/a.zip", dryRun: true, logs: [] })
    render(<Component compId="comp-smartzip" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "解压归档" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("extract")
    expect(host.cardState.action).toBe("extract")
  })

  test("marks the card as error when extract has no paths", async () => {
    setSurface("regular")
    const host = createHost({ action: "extract", logs: [] })
    render(<Component compId="comp-smartzip" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "解压归档" }))

    expect(host.runCalls).toHaveLength(0)
    await waitFor(() => expect(host.cardState.phase).toBe("error"))
    expect(host.cardState.progressText).toContain("归档或目录")
  })
})

type TestHost = NodeHostApi<SmartZipCardState, Partial<SmartZipCardState>> & {
  copiedText: string
  runCalls: Array<{ nodeId: string; input: SmartZipInput }>
  savedConfig: Partial<SmartZipCardState> | undefined
  cardState: SmartZipCardState
}

function createHost(initial: SmartZipCardState): TestHost {
  const stateCapability = {
    getData: () => host.cardState,
    patchData: (patch: Partial<SmartZipCardState>) => {
      host.cardState = { ...host.cardState, ...patch }
    },
  }

  const host: TestHost = {
    cardState: { ...initial },
    runCalls: [],
    copiedText: "",
    savedConfig: undefined,
    contract: {
      name: "xiranite.node-host",
      version: "1.0.0",
      supportedCapabilities: ["contract", "state", "runner", "clipboard", "config", "env"],
      hasCapability: (capability) => ["contract", "state", "runner", "clipboard", "config", "env"].includes(capability),
    },
    env: {
      theme: "light",
      platform: "web",
    },
    state: stateCapability,
    runner: {
      run: async <TInput, TData>(
        nodeId: string,
        input: TInput,
        onEvent?: (event: NodeRunEvent) => void,
      ): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as SmartZipInput })
        onEvent?.({ type: "progress", progress: 50, message: "Loading SmartZip config." })
        return {
          success: true,
          message: "SmartZip status loaded.",
          data: smartzipData as TData,
        }
      },
    },
    clipboard: {
      readText: async () => "D:/archives/a.zip",
      writeText: async (text) => {
        host.copiedText = text
      },
    },
    config: {
      get: async () => ({ config: undefined, path: "D:/config/xiranite.config.toml" }),
      save: async (config) => {
        host.savedConfig = config
      },
      openFile: () => undefined,
    },
    getData: <T,>() => stateCapability.getData() as T | undefined,
    patchData: (_compId, patch) => stateCapability.patchData(patch),
    listComponents: () => [],
    updateComponent: () => undefined,
    actions: undefined,
    getNodeConfig: async <T,>() => ({ config: undefined as T | undefined, path: "D:/config/xiranite.config.toml" }),
    saveNodeConfig: async (config) => {
      host.savedConfig = config as Partial<SmartZipCardState>
    },
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

const smartzipData: SmartZipData = {
  config: {
    sevenZipDir: "%SmartZipDir%\\7-zip",
    passwords: [],
    archiveExtensions: ["zip", "7z", "rar"],
    contextMenu: true,
    sendTo: true,
  },
  selectedPaths: ["D:/archives/a.zip"],
  archiveCount: 1,
  errors: [],
}
