// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import type { KavvkaData, KavvkaInput } from "@xiranite/node-kavvka/core"
import { Component } from "./Component"
import type { KavvkaCardState } from "./types"

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

describe("app-owned kavvka Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)(
    "renders the %s surface with Kavvka-specific UI",
    (mode) => {
      setSurface(mode)
      render(<Component compId="comp-kavvka" host={createHost({ sourceText: "D:/library/[artist] bundle/gallery" })} />)

      expect(screen.getByText("Kavvka")).toBeTruthy()
      if (mode === "collapsed") {
        expect(screen.getByTestId("kavvka-collapsed-view")).toBeTruthy()
        expect(screen.getByText(/1 源/)).toBeTruthy()
        expect(screen.queryByLabelText("kavvka source paths")).toBeNull()
        return
      }

      expect(screen.getByLabelText("kavvka source paths")).toBeTruthy()
      expect(screen.getByLabelText("kavvka scan roots")).toBeTruthy()

      if (mode === "compact") {
        expect(screen.getByTestId("kavvka-compact-view")).toBeTruthy()
        expect(screen.getByRole("button", { name: "kavvka advanced options" })).toBeTruthy()
      } else if (mode === "portrait") {
        expect(screen.getByTestId("kavvka-portrait-view")).toBeTruthy()
        expect(screen.getByTestId("kavvka-key-switches")).toBeTruthy()
      } else {
        expect(screen.getByTestId("kavvka-full-view")).toBeTruthy()
        expect(screen.getByText("扫描根目录")).toBeTruthy()
        expect(screen.getByText("活动冲突")).toBeTruthy()
        expect(screen.getByTestId("kavvka-header-toolbar")).toBeTruthy()
      }
    },
  )

  test("forces collapsed content when compact surface height is too short", () => {
    setSurfaceSize({ width: 420, height: 159 })

    render(<Component compId="comp-kavvka" host={createHost({ sourceText: "D:/library/[artist] bundle/gallery" })} />)

    expect(screen.getByTestId("kavvka-collapsed-view")).toBeTruthy()
    expect(screen.queryByLabelText("kavvka source paths")).toBeNull()
  })

  test("uses portrait compact layout for tall compact surfaces", () => {
    setSurfaceSize({ width: 559, height: 300 })

    render(<Component compId="comp-kavvka" host={createHost({ sourceText: "D:/library/[artist] bundle/gallery" })} />)

    expect(screen.getByTestId("kavvka-portrait-view")).toBeTruthy()
    expect(screen.queryByTestId("kavvka-compact-view")).toBeNull()
  })

  test("pastes source paths from the clipboard", async () => {
    setSurface("compact")
    const host = createHost({})
    render(<Component compId="comp-kavvka" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "粘贴源路径" }))

    expect(host.state.sourceText).toBe("D:/library/[artist] bundle/gallery")
  })

  test("runs scan through host.actions.run and backfills matched paths to source", async () => {
    setSurface("regular")
    const host = createHost({ scanRootText: "D:/library", dryRun: true, logs: [] })
    render(<Component compId="comp-kavvka" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "扫描关键词" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "kavvka",
      input: {
        action: "scan",
        pathText: undefined,
        scanRootText: "D:/library",
        keywordText: undefined,
        scanDepth: 3,
        force: true,
        dryRun: true,
        strictArtist: false,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.sourceText).toBe("D:/library/[artist] bundle/gallery")
    expect(host.state.logs?.at(-1)).toBe("Scan completed: 1 matching folder(s).")
  })

  test("runs process through host.actions.run with dry-run default enabled", async () => {
    setSurface("regular")
    const host = createHost({
      sourceText: "D:/library/[artist] bundle/gallery",
      strictArtist: true,
      logs: [],
    })
    render(<Component compId="comp-kavvka" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "执行处理" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "kavvka",
      input: {
        action: "process",
        pathText: "D:/library/[artist] bundle/gallery",
        scanRootText: undefined,
        keywordText: undefined,
        scanDepth: 3,
        force: true,
        dryRun: true,
        strictArtist: true,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.result?.allCombinedPaths).toEqual(["D:/library/[artist] bundle/gallery;D:/library/[artist] bundle/#compare"])
    expect(host.state.logs?.at(-1)).toBe("Process completed: 1/1 path(s), 0 folder(s) moved.")
  })

  test("catches thrown runner errors and appends the message to logs", async () => {
    setSurface("regular")
    const host = createHost({ sourceText: "D:/library/[artist] bundle/gallery", logs: [] }, { runError: new Error("backend offline") })
    render(<Component compId="comp-kavvka" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "执行处理" }))

    await waitFor(() => expect(host.state.phase).toBe("error"))
    expect(host.state.progressText).toBe("backend offline")
    expect(host.state.logs?.at(-1)).toBe("backend offline")
  })

  test("marks the card as error when the runner returns a failed response", async () => {
    setSurface("regular")
    const host = createHost(
      { sourceText: "D:/library/[artist] bundle/gallery", logs: [] },
      { runResult: { success: false, message: "Path invalid.", data: { ...kavvkaData, errors: ["bad path"], errorCount: 1 } } },
    )
    render(<Component compId="comp-kavvka" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "执行处理" }))

    await waitFor(() => expect(host.state.phase).toBe("error"))
    expect(host.state.progressText).toBe("Path invalid.")
    expect(host.state.logs?.at(-1)).toBe("Path invalid.")
  })

  test("uses confirmation for real process when dry run is disabled", async () => {
    setSurface("regular")
    const host = createHost({ sourceText: "D:/library/[artist] bundle/gallery", dryRun: false, logs: [] })
    render(<Component compId="comp-kavvka" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "真实处理" }))
    expect(screen.getByText("确认真实执行 Kavvka？")).toBeTruthy()

    await user.click(screen.getByText("确认执行"))
    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("process")
    expect(host.runCalls[0]?.input.dryRun).toBe(false)
  })

  test("uses the shared configuration-management workflow", async () => {
    setSurface("regular")
    const host = createHost(
      { sourceText: "D:/current", dryRun: true },
      { config: { sourceText: "D:/default", dryRun: false } },
    )
    render(<Component compId="comp-kavvka" host={host} />)
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByRole("button", { name: "配置管理" }).className).toContain("bg-secondary"))
    await user.click(screen.getByRole("button", { name: "配置管理" }))
    await user.click(screen.getByRole("button", { name: "恢复默认" }))
    expect(host.state.sourceText).toBe("D:/default")
    expect(host.state.dryRun).toBe(false)

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
  runCalls: Array<{ nodeId: string; input: KavvkaInput }>
  savedConfig: Partial<KavvkaCardState> | undefined
  state: KavvkaCardState
}

type HostOptions = {
  config?: Partial<KavvkaCardState>
  runError?: Error
  runResult?: NodeRunResult<KavvkaData>
}

function createHost(initial: KavvkaCardState, options: HostOptions = {}): TestHost {
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
        host.runCalls.push({ nodeId, input: input as KavvkaInput })
        if (options.runError) throw options.runError
        onEvent?.({ type: "progress", progress: 25, message: "Reading paths." })
        onEvent?.({ type: "log", message: "Planning combined paths." })
        onEvent?.({ type: "progress", progress: 100, message: "Process completed." })
        return (options.runResult ?? {
          success: true,
          message: input && (input as KavvkaInput).action === "scan"
            ? "Scan completed: 1 matching folder(s)."
            : "Process completed: 1/1 path(s), 0 folder(s) moved.",
          data: input && (input as KavvkaInput).action === "scan"
            ? { ...kavvkaData, allCombinedPaths: [], matchedPaths: ["D:/library/[artist] bundle/gallery"], scanResults: [{ path: "D:/library/[artist] bundle/gallery", name: "[artist] bundle", root: "D:/library" }] }
            : kavvkaData,
        }) as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/library/[artist] bundle/gallery",
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
      host.savedConfig = config as Partial<KavvkaCardState>
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

const kavvkaData: KavvkaData = {
  allCombinedPaths: ["D:/library/[artist] bundle/gallery;D:/library/[artist] bundle/#compare"],
  matchedPaths: [],
  processResults: [
    {
      path: "D:/library/[artist] bundle/gallery",
      artistFolder: "D:/library/[artist] bundle",
      compareFolder: "D:/library/[artist] bundle/#compare",
      siblingFolders: ["D:/library/[artist] bundle/old scan"],
      movedFolders: [
        {
          source: "D:/library/[artist] bundle/old scan",
          target: "D:/library/[artist] bundle/#compare/old scan",
          success: true,
        },
      ],
      combinedPath: "D:/library/[artist] bundle/gallery;D:/library/[artist] bundle/#compare",
      warnings: [],
      success: true,
    },
  ],
  scanResults: [],
  processedCount: 1,
  movedCount: 0,
  skippedCount: 0,
  errorCount: 0,
  errors: [],
}
