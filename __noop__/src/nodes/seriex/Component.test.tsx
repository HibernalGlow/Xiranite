// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import type { SeriexData, SeriexInput } from "@xiranite/node-seriex/core"
import { Component } from "./Component"
import type { SeriexCardState } from "./types"

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

describe("app-owned seriex Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)(
    "renders the %s surface with Seriex-specific UI",
    (mode) => {
      setSurface(mode)
      render(<Component compId="comp-seriex" host={createHost({ directoryPath: "D:/Media/Novels" })} />)

      expect(screen.getByText("Seriex")).toBeTruthy()
      if (mode === "collapsed") {
        expect(screen.getByTestId("seriex-collapsed-view")).toBeTruthy()
        expect(screen.queryByTestId("seriex-action-picker")).toBeNull()
        return
      }

      expect(screen.getByTestId("seriex-action-picker")).toBeTruthy()

      if (mode === "compact") {
        expect(screen.getByTestId("seriex-compact-view")).toBeTruthy()
        expect(screen.getByRole("button", { name: "seriex advanced options" })).toBeTruthy()
      } else if (mode === "portrait") {
        expect(screen.getByTestId("seriex-portrait-view")).toBeTruthy()
        expect(screen.getByTestId("seriex-key-switches")).toBeTruthy()
      } else {
        expect(screen.getByTestId("seriex-full-view")).toBeTruthy()
        expect(screen.getByText("系列扫描")).toBeTruthy()
        expect(screen.getByText("检测到的系列")).toBeTruthy()
        expect(screen.getByTestId("seriex-header-toolbar")).toBeTruthy()
        expect(screen.getByTestId("seriex-stats-panel")).toBeTruthy()
      }
    },
  )

  test("forces collapsed content when compact surface height is too short", () => {
    setSurfaceSize({ width: 420, height: 159 })

    render(<Component compId="comp-seriex" host={createHost({ directoryPath: "D:/Media/Novels" })} />)

    expect(screen.getByTestId("seriex-collapsed-view")).toBeTruthy()
    expect(screen.queryByTestId("seriex-action-picker")).toBeNull()
  })

  test("uses portrait compact layout for tall compact surfaces", () => {
    setSurfaceSize({ width: 559, height: 300 })

    render(<Component compId="comp-seriex" host={createHost({ directoryPath: "D:/Media/Novels" })} />)

    expect(screen.getByTestId("seriex-portrait-view")).toBeTruthy()
    expect(screen.queryByTestId("seriex-compact-view")).toBeNull()
  })

  test("runs a plan through host.actions.run when clicking the preview action", async () => {
    setSurface("regular")
    const host = createHost({ directoryPath: "D:/Media/Novels", logs: [] })
    render(<Component compId="comp-seriex" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "预览计划" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "seriex",
      input: {
        action: "plan",
        directoryPath: "D:/Media/Novels",
        configPath: undefined,
        configText: undefined,
        knownSeriesNames: [],
        prefix: "[#s]",
        addPrefix: true,
        dryRun: true,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.result?.totalSeries).toBe(2)
    expect(host.state.logs?.at(-1)).toBe("Plan generated: 2 series, 4 file(s).")
  })

  test("uses confirmation before executing file moves", async () => {
    setSurface("regular")
    const host = createHost({ directoryPath: "D:/Media/Novels", logs: [] })
    render(<Component compId="comp-seriex" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "执行移动" }))

    expect(host.runCalls).toHaveLength(0)
    expect(screen.getByText("确认执行文件移动？")).toBeTruthy()

    await user.click(screen.getByText("确认执行"))
    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("execute")
    expect(host.runCalls[0]?.input.dryRun).toBe(false)
  })

  test("catches thrown runner errors and appends the message to logs", async () => {
    setSurface("regular")
    const host = createHost({ directoryPath: "D:/Media/Novels", logs: [] }, { runError: new Error("backend offline") })
    render(<Component compId="comp-seriex" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "预览计划" }))

    await waitFor(() => expect(host.state.phase).toBe("error"))
    expect(host.state.progressText).toBe("backend offline")
    expect(host.state.logs?.at(-1)).toBe("backend offline")
  })

  test("uses the shared configuration-management workflow", async () => {
    setSurface("regular")
    const host = createHost(
      { directoryPath: "D:/current", prefix: "[#s]" },
      { config: { directoryPath: "D:/default", prefix: "[#s]" } },
    )
    render(<Component compId="comp-seriex" host={host} />)
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByRole("button", { name: "配置管理" })).toBeTruthy())
    await user.click(screen.getByRole("button", { name: "配置管理" }))
    await user.click(screen.getByRole("button", { name: "恢复默认" }))
    expect(host.state.directoryPath).toBe("D:/default")

    await user.click(screen.getByRole("button", { name: "保存为默认" }))
    expect(host.savedConfig).toBeDefined()

    await user.click(screen.getByRole("button", { name: "重新读取" }))
    await user.click(screen.getByRole("button", { name: "打开文件" }))
    expect(host.openConfigFileCalls).toBe(1)
  })
})

type TestHost = NodeHostApi & {
  copiedText: string
  openConfigFileCalls: number
  runCalls: Array<{ nodeId: string; input: SeriexInput }>
  savedConfig: Partial<SeriexCardState> | undefined
  state: SeriexCardState
}

type HostOptions = {
  config?: Partial<SeriexCardState>
  runError?: Error
  runResult?: NodeRunResult<SeriexData>
}

function createHost(initial: SeriexCardState, options: HostOptions = {}): TestHost {
  const host: TestHost = {
    state: { ...initial },
    runCalls: [],
    copiedText: "",
    savedConfig: undefined,
    openConfigFileCalls: 0,
    getData: <T,>() => host.state as T,
    patchData: (_compId, patch) => {
      host.state = { ...host.state, ...patch }
    },
    listComponents: () => [],
    updateComponent: () => undefined,
    actions: {
      run: async <TInput, TData>(
        nodeId: string,
        input: TInput,
        onEvent?: (event: NodeRunEvent) => void,
      ): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as SeriexInput })
        if (options.runError) throw options.runError
        onEvent?.({ type: "progress", progress: 30, message: "Planning directory." })
        onEvent?.({ type: "log", message: "Reading files." })
        onEvent?.({ type: "progress", progress: 100, message: "Plan complete." })
        return (options.runResult ?? {
          success: true,
          message: "Plan generated: 2 series, 4 file(s).",
          data: seriexData,
        }) as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "formats = [\".mp4\"]",
      writeText: async (text) => {
        host.copiedText = text
      },
    },
    env: {
      theme: "light",
      platform: "web",
    },
    getNodeConfig: async <T,>() => ({ config: options.config as T | undefined, path: "D:/config/xiranite.config.toml" }),
    saveNodeConfig: async (config) => {
      host.savedConfig = config as Partial<SeriexCardState>
    },
    openConfigFile: () => {
      host.openConfigFileCalls += 1
    },
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

const seriexData: SeriexData = {
  plan: {
    "D:/Media/Novels": {
      "[#s]SeriesA": ["D:/Media/Novels/a1.mp4", "D:/Media/Novels/a2.mp4"],
      "[#s]SeriesB": ["D:/Media/Novels/b1.mp4", "D:/Media/Novels/b2.mp4"],
    },
  },
  summary: {},
  planItems: [
    { directory: "D:/Media/Novels", folder: "[#s]SeriesA", files: ["D:/Media/Novels/a1.mp4", "D:/Media/Novels/a2.mp4"] },
    { directory: "D:/Media/Novels", folder: "[#s]SeriesB", files: ["D:/Media/Novels/b1.mp4", "D:/Media/Novels/b2.mp4"] },
  ],
  moveItems: [],
  totalSeries: 2,
  totalFiles: 4,
  movedCount: 0,
  failedCount: 0,
  errors: [],
}
