// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import type { MoveaData, MoveaInput } from "@xiranite/node-movea/core"
import { Component } from "./Component"
import type { MoveaCardState } from "./types"

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

describe("app-owned movea Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)(
    "renders the %s surface with Movea-specific UI",
    (mode) => {
      setSurface(mode)
      render(<Component compId="comp-movea" host={createHost({ rootPath: "D:/gallery" })} />)

      expect(screen.getByText("Movea")).toBeTruthy()
      if (mode === "collapsed") {
        expect(screen.getByTestId("movea-collapsed-view")).toBeTruthy()
        expect(screen.getByText(/输入根路径后扫描目录/)).toBeTruthy()
        expect(screen.queryByLabelText("根路径")).toBeNull()
        return
      }

      expect(screen.getByLabelText("根路径")).toBeTruthy()
      expect(screen.getByRole("tab", { name: "匹配" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "日志" })).toBeTruthy()

      if (mode === "compact") {
        expect(screen.getByTestId("movea-compact-view")).toBeTruthy()
        expect(screen.getByRole("button", { name: "movea options" })).toBeTruthy()
      } else if (mode === "portrait") {
        expect(screen.getByTestId("movea-portrait-view")).toBeTruthy()
        expect(screen.getByTestId("movea-key-switches")).toBeTruthy()
      } else {
        expect(screen.getByTestId("movea-full-view")).toBeTruthy()
        expect(screen.getByText("关键开关")).toBeTruthy()
        expect(screen.getByText("匹配与计划")).toBeTruthy()
        expect(screen.getByTestId("movea-header-toolbar")).toBeTruthy()
      }
    },
  )

  test("forces collapsed content when compact surface height is too short", () => {
    setSurfaceSize({ width: 420, height: 159 })

    render(<Component compId="comp-movea" host={createHost({ rootPath: "D:/gallery" })} />)

    expect(screen.getByTestId("movea-collapsed-view")).toBeTruthy()
    expect(screen.queryByLabelText("根路径")).toBeNull()
  })

  test("uses portrait compact layout for tall compact surfaces", () => {
    setSurfaceSize({ width: 559, height: 300 })

    render(<Component compId="comp-movea" host={createHost({ rootPath: "D:/gallery" })} />)

    expect(screen.getByTestId("movea-portrait-view")).toBeTruthy()
    expect(screen.queryByTestId("movea-compact-view")).toBeNull()
  })

  test("pastes root path from the clipboard", async () => {
    setSurface("compact")
    const host = createHost({})
    render(<Component compId="comp-movea" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "粘贴根路径" }))

    expect(host.state.rootPath).toBe("D:/gallery")
  })

  test("runs scan through host.actions.run and stores scan results", async () => {
    setSurface("regular")
    const host = createHost({ rootPath: "D:/gallery", logs: [] })
    render(<Component compId="comp-movea" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "扫描目录" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "movea",
      input: {
        action: "scan",
        rootPath: "D:/gallery",
        regexPatterns: [],
        level1Name: undefined,
        movePlan: {},
        dryRun: true,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.result?.totalFolders).toBe(1)
    expect(host.state.result?.totalArchives).toBe(2)
    expect(host.state.logs?.at(-1)).toBe("Scan completed: 1 folder(s), 2 archive(s).")
  })

  test("uses confirmation dialog for move when dry run is off", async () => {
    setSurface("regular")
    const host = createHost({ rootPath: "D:/gallery", level1Name: "artist-a", dryRun: false, logs: [] })
    render(<Component compId="comp-movea" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "执行移动" }))
    expect(screen.getByText("确认真实执行 Movea 移动？")).toBeTruthy()

    await user.click(screen.getByText("确认执行"))
    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("move_single")
    expect(host.runCalls[0]?.input.dryRun).toBe(false)
  })
})

type TestHost = NodeHostApi & {
  copiedText: string
  runCalls: Array<{ nodeId: string; input: MoveaInput }>
  state: MoveaCardState
}

type HostOptions = {
  runError?: Error
  runResult?: NodeRunResult<MoveaData>
}

function createHost(initial: MoveaCardState, options: HostOptions = {}): TestHost {
  const host: TestHost = {
    state: { ...initial },
    runCalls: [],
    copiedText: "",
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
        host.runCalls.push({ nodeId, input: input as MoveaInput })
        if (options.runError) throw options.runError
        onEvent?.({ type: "progress", progress: 50, message: "Scanning D:/gallery" })
        onEvent?.({ type: "log", message: "Classifying entries." })
        onEvent?.({ type: "progress", progress: 100, message: "Scan completed." })
        return (options.runResult ?? {
          success: true,
          message: "Scan completed: 1 folder(s), 2 archive(s).",
          data: moveaData,
        }) as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/gallery",
      writeText: async (text) => {
        host.copiedText = text
      },
    },
    env: {
      theme: "light",
      platform: "web",
    },
    getNodeConfig: async <T,>() => ({ config: options.runResult as T | undefined, path: "D:/config/xiranite.config.toml" }),
    saveNodeConfig: async () => undefined,
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

const moveaData: MoveaData = {
  scanResults: {
    "artist-a": {
      name: "artist-a",
      path: "D:/gallery/artist-a",
      subfolders: ["01 work"],
      archives: ["book.zip", "art.7z"],
      movableFolders: [],
    },
  },
  matchedFolders: [],
  moveItems: [],
  totalFolders: 1,
  totalArchives: 2,
  totalMovableFolders: 0,
  moveSuccess: 0,
  moveFailed: 0,
  errors: [],
}
