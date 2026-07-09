// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { CoveruData, CoveruInput } from "@xiranite/node-coveru/core"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import { Component } from "./Component"
import type { CoveruCardState } from "./types"

const surfaceState = vi.hoisted(() => ({ height: 420, width: 720 }))

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

describe("app-owned coveru Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)(
    "renders the %s surface with native CoverU UI",
    (mode) => {
      setSurface(mode)
      render(<Component compId="comp-coveru" host={createHost({ pathsText: "D:/archives/book.zip" })} />)

      expect(screen.getByText("CoverU")).toBeTruthy()
      if (mode === "collapsed") {
        expect(screen.getByTestId("coveru-collapsed-view")).toBeTruthy()
        expect(screen.queryByLabelText("coveru paths")).toBeNull()
        return
      }

      expect(screen.getByLabelText("coveru paths")).toBeTruthy()
      expect(screen.getByRole("tab", { name: "结果" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "问题" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "日志" })).toBeTruthy()
      expect(screen.queryByText(/python/i)).toBeNull()
      expect(screen.queryByText(/sourceRoot|moduleName/)).toBeNull()

      if (mode === "compact") {
        expect(screen.getByTestId("coveru-compact-view")).toBeTruthy()
      } else if (mode === "portrait") {
        expect(screen.getByTestId("coveru-portrait-view")).toBeTruthy()
      } else {
        expect(screen.getByTestId("coveru-full-view")).toBeTruthy()
        expect(screen.getByTestId("coveru-header-toolbar")).toBeTruthy()
        expect(screen.getByText("归档队列")).toBeTruthy()
        expect(screen.getByText("封面候选")).toBeTruthy()
        expect(screen.getByText("执行")).toBeTruthy()
      }
    },
  )

  test("runs plan through host.runner.run and stores cover candidates", async () => {
    setSurface("regular")
    const host = createHost({ action: "plan", pathsText: "D:/archives/book.zip", dryRun: true, logs: [] })
    render(<Component compId="comp-coveru" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "生成计划" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "coveru",
      input: {
        action: "plan",
        paths: ["D:/archives/book.zip"],
        outputDir: undefined,
        outputMode: "alongside",
        overwrite: false,
        recursive: true,
        dryRun: true,
        preferredNames: ["cover", "folder", "front", "000", "001"],
      },
    })
    await waitFor(() => expect(host.cardState.phase).toBe("completed"))
    expect(host.cardState.result?.candidates[0]?.sourceEntry).toBe("cover.jpg")
  })

  test("requires confirmation before live extract execution", async () => {
    setSurface("regular")
    const host = createHost({ action: "extract", pathsText: "D:/archives/book.zip", dryRun: false, logs: [] })
    render(<Component compId="comp-coveru" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "提取封面" }))
    expect(host.runCalls).toHaveLength(0)
    expect(screen.getByText("确认提取封面？")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "确认提取" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("extract")
    expect(host.runCalls[0]?.input.dryRun).toBe(false)
  })

  test("marks the card as error when run has no paths", async () => {
    setSurface("regular")
    const host = createHost({ action: "extract", logs: [] })
    render(<Component compId="comp-coveru" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "提取封面" }))

    expect(host.runCalls).toHaveLength(0)
    await waitFor(() => expect(host.cardState.phase).toBe("error"))
    expect(host.cardState.progressText).toContain("归档")
  })
})

type TestHost = NodeHostApi<CoveruCardState, Partial<CoveruCardState>> & {
  copiedText: string
  runCalls: Array<{ nodeId: string; input: CoveruInput }>
  savedConfig: Partial<CoveruCardState> | undefined
  cardState: CoveruCardState
}

function createHost(initial: CoveruCardState): TestHost {
  const stateCapability = {
    getData: () => host.cardState,
    patchData: (patch: Partial<CoveruCardState>) => {
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
    env: { theme: "light", platform: "web" },
    state: stateCapability,
    runner: {
      run: async <TInput, TData>(
        nodeId: string,
        input: TInput,
        onEvent?: (event: NodeRunEvent) => void,
      ): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as CoveruInput })
        onEvent?.({ type: "progress", progress: 50, message: "Planning cover candidates." })
        return {
          success: true,
          message: "CoverU planned 1 candidate.",
          data: coveruData as TData,
        }
      },
    },
    clipboard: {
      readText: async () => "D:/archives/book.zip",
      writeText: async (text) => { host.copiedText = text },
    },
    config: {
      get: async () => ({ config: undefined, path: "D:/config/xiranite.config.toml" }),
      save: async (config) => { host.savedConfig = config },
      openFile: () => undefined,
    },
    getData: <T,>() => stateCapability.getData() as T | undefined,
    patchData: (_compId, patch) => stateCapability.patchData(patch),
    listComponents: () => [],
    updateComponent: () => undefined,
    actions: undefined,
    getNodeConfig: async <T,>() => ({ config: undefined as T | undefined, path: "D:/config/xiranite.config.toml" }),
    saveNodeConfig: async (config) => { host.savedConfig = config as Partial<CoveruCardState> },
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

const coveruData: CoveruData = {
  candidates: [
    {
      sourcePath: "D:/archives/book.zip",
      sourceEntry: "cover.jpg",
      outputPath: "D:/archives/book.jpg",
      sourceKind: "archive-entry",
      extension: ".jpg",
      score: 100,
      status: "ready",
    },
  ],
  archiveCount: 1,
  readyCount: 1,
  extractedCount: 0,
  skippedCount: 0,
  errorCount: 0,
  unsupportedCount: 0,
  errors: [],
}
