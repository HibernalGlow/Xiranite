// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { SimiuData, SimiuInput } from "@xiranite/node-simiu/core"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import { Component } from "./Component"
import type { SimiuCardState } from "./types"

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

describe("app-owned simiu Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)(
    "renders the %s surface with Simiu-specific UI",
    (mode) => {
      setSurface(mode)
      render(<Component compId="comp-simiu" host={createHost({ rootsText: "D:/images/a" })} />)

      expect(screen.getByText("Simiu")).toBeTruthy()
      if (mode === "collapsed") {
        expect(screen.getByTestId("simiu-collapsed-view")).toBeTruthy()
        expect(screen.getByText(/1 个根目录等待/)).toBeTruthy()
        expect(screen.queryByLabelText("simiu 图片根目录")).toBeNull()
        return
      }

      expect(screen.getByLabelText("simiu 图片根目录")).toBeTruthy()
      expect(screen.getByRole("tab", { name: "分组" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "操作" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "日志" })).toBeTruthy()

      if (mode === "compact") {
        expect(screen.getByTestId("simiu-compact-view")).toBeTruthy()
      } else if (mode === "portrait") {
        expect(screen.getByTestId("simiu-portrait-view")).toBeTruthy()
      } else {
        expect(screen.getByTestId("simiu-full-view")).toBeTruthy()
        expect(screen.getByTestId("simiu-header-toolbar")).toBeTruthy()
        expect(screen.getByText("输入")).toBeTruthy()
        expect(screen.getByText("运行")).toBeTruthy()
      }
    },
  )

  test("runs a plan through host.runner.run and stores groups", async () => {
    setSurface("regular")
    const host = createHost({
      rootsText: "D:/images/a\nD:/images/b",
      configPath: "D:/simiu.toml",
      databasePath: "D:/simiu-runs.jsonl",
      mode: "copy",
      scanOrder: "deepest-first",
      minGroupSize: "3",
      sizeToleranceBytes: "128",
      dryRun: true,
      recordRun: true,
      logs: [],
    })
    render(<Component compId="comp-simiu" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "运行计划" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "simiu",
      input: {
        action: "plan",
        root: "D:/images/a",
        roots: ["D:/images/a", "D:/images/b"],
        configPath: "D:/simiu.toml",
        databasePath: "D:/simiu-runs.jsonl",
        mode: "copy",
        scanOrder: "deepest-first",
        namePrefix: undefined,
        minGroupSize: 3,
        sizeToleranceBytes: 128,
        dryRun: true,
        recordRun: true,
        recursive: true,
      },
    })
    await waitFor(() => expect(host.cardState.phase).toBe("completed"))
    expect(host.cardState.result?.groups).toHaveLength(1)
    expect(screen.getAllByText(/simiu_set__set_001/).length).toBeGreaterThanOrEqual(1)
  })

  test("requires confirmation before real apply execution", async () => {
    setSurface("regular")
    const host = createHost({ action: "apply", rootsText: "D:/images/a", dryRun: false, logs: [] })
    render(<Component compId="comp-simiu" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "运行应用" }))
    expect(host.runCalls).toHaveLength(0)
    expect(screen.getByText("确认真实应用分组？")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "确认应用" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("apply")
    expect(host.runCalls[0]?.input.dryRun).toBe(false)
  })

  test("marks the card as error when no root is provided", async () => {
    setSurface("regular")
    const host = createHost({ logs: [] })
    render(<Component compId="comp-simiu" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "运行计划" }))

    expect(host.runCalls).toHaveLength(0)
    await waitFor(() => expect(host.cardState.phase).toBe("error"))
    expect(host.cardState.progressText).toContain("至少一个图片根目录")
  })
})

type TestHost = NodeHostApi<SimiuCardState, Partial<SimiuCardState>> & {
  copiedText: string
  runCalls: Array<{ nodeId: string; input: SimiuInput }>
  savedConfig: Partial<SimiuCardState> | undefined
  cardState: SimiuCardState
}

function createHost(initial: SimiuCardState): TestHost {
  const stateCapability = {
    getData: () => host.cardState,
    patchData: (patch: Partial<SimiuCardState>) => {
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
        host.runCalls.push({ nodeId, input: input as SimiuInput })
        onEvent?.({ type: "progress", progress: 40, message: "Planning similar image groups." })
        return {
          success: true,
          message: "Simiu planned 1 group(s).",
          data: simiuData as TData,
        }
      },
    },
    clipboard: {
      readText: async () => "D:/images/a",
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
      host.savedConfig = config as Partial<SimiuCardState>
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

const simiuData: SimiuData = {
  batches: [
    {
      folder: "D:/images/a",
      images: [
        { path: "D:/images/a/001.jpg", signature: "120:.jpg", size: 120 },
        { path: "D:/images/a/002.jpg", signature: "120:.jpg", size: 120 },
      ],
    },
  ],
  groups: [
    {
      parentDir: "D:/images/a",
      name: "simiu_set__set_001",
      files: ["D:/images/a/001.jpg", "D:/images/a/002.jpg"],
    },
  ],
  operations: [
    {
      mode: "copy",
      sourcePath: "D:/images/a/001.jpg",
      targetPath: "D:/images/a/simiu_set__set_001/001.jpg",
      status: "planned",
    },
  ],
  config: undefined,
  database: {
    path: "D:/images/a/.xiranite/simiu-runs.jsonl",
    enabled: true,
    mode: "jsonl",
    defaultPath: true,
  },
  imageCount: 2,
  groupCount: 1,
  movedCount: 0,
  skippedCount: 0,
  errorCount: 0,
  errors: [],
}
