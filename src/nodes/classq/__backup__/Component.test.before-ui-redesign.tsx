// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import type { PackuToolData, PackuToolInput } from "@xiranite/packu-node-runtime/core"
import { Component } from "./Component"
import type { ClassqCardState } from "./types"
import { NODE_META } from "./constants"

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

describe("app-owned classq Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)(
    "renders the %s surface with ClassQ-specific UI",
    (mode) => {
      setSurface(mode)
      render(<Component compId="comp-classq" host={createHost({ pathsText: "D:/archives/a.zip" })} />)

      expect(screen.getByText("ClassQ")).toBeTruthy()
      if (mode === "collapsed") {
        expect(screen.getByTestId("classq-collapsed-view")).toBeTruthy()
        expect(screen.queryByLabelText("classq 归档或目录")).toBeNull()
        return
      }

      expect(screen.getByLabelText("classq 归档或目录")).toBeTruthy()

      if (mode === "compact") {
        expect(screen.getByTestId("classq-compact-view")).toBeTruthy()
        expect(screen.getByRole("tab", { name: "命令" })).toBeTruthy()
        expect(screen.getByRole("tab", { name: "集成" })).toBeTruthy()
        expect(screen.getByRole("tab", { name: "日志" })).toBeTruthy()
      } else if (mode === "portrait") {
        expect(screen.getByTestId("classq-portrait-view")).toBeTruthy()
        expect(screen.getByRole("tab", { name: "命令" })).toBeTruthy()
        expect(screen.getByRole("tab", { name: "集成" })).toBeTruthy()
        expect(screen.getByRole("tab", { name: "日志" })).toBeTruthy()
      } else {
        expect(screen.getByTestId("classq-full-view")).toBeTruthy()
        expect(screen.getByTestId("classq-header-toolbar")).toBeTruthy()
        expect(screen.getAllByText("待分拣").length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText("已分拣").length).toBeGreaterThanOrEqual(1)
      }
    },
  )

  test("runs plan through host.runner.run and stores command results", async () => {
    setSurface("regular")
    const host = createHost({ action: "plan", pathsText: "D:/archives/a.zip", dryRun: true, logs: [] })
    render(<Component compId="comp-classq" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "生成计划" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "classq",
      input: {
        action: "plan",
        paths: ["D:/archives/a.zip"],
        args: [],
        configPath: undefined,
        databasePath: undefined,
        python: undefined,
        sourceRoot: NODE_META.spec.sourceRoot,
        moduleName: NODE_META.spec.moduleName,
        dryRun: true,
        recordRun: false,
      },
    })
    await waitFor(() => expect(host.cardState.phase).toBe("completed"))
    expect(host.cardState.result?.command).toBeTruthy()

    await waitFor(() => expect(screen.getAllByText(/python/).length).toBeGreaterThanOrEqual(1))
  })

  test("requires confirmation before real run execution", async () => {
    setSurface("regular")
    const host = createHost({ action: "run", pathsText: "D:/archives/a.zip", dryRun: false, logs: [] })
    render(<Component compId="comp-classq" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "执行分类" }))
    expect(host.runCalls).toHaveLength(0)
    expect(screen.getByText("确认执行分类？")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "确认执行" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("run")
    expect(host.runCalls[0]?.input.dryRun).toBe(false)
  })

  test("marks the card as error when run has no paths", async () => {
    setSurface("regular")
    const host = createHost({ action: "run", logs: [] })
    render(<Component compId="comp-classq" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "执行分类" }))

    expect(host.runCalls).toHaveLength(0)
    await waitFor(() => expect(host.cardState.phase).toBe("error"))
    expect(host.cardState.progressText).toContain("归档或目录")
  })
})

type TestHost = NodeHostApi<ClassqCardState, Partial<ClassqCardState>> & {
  copiedText: string
  runCalls: Array<{ nodeId: string; input: PackuToolInput }>
  savedConfig: Partial<ClassqCardState> | undefined
  cardState: ClassqCardState
}

function createHost(initial: ClassqCardState): TestHost {
  const stateCapability = {
    getData: () => host.cardState,
    patchData: (patch: Partial<ClassqCardState>) => {
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
        host.runCalls.push({ nodeId, input: input as PackuToolInput })
        onEvent?.({ type: "progress", progress: 50, message: "Planning classq tool." })
        return {
          success: true,
          message: "ClassQ planned classification.",
          data: packuData as TData,
        }
      },
    },
    clipboard: {
      readText: async () => "D:/archives/a.zip",
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
    saveNodeConfig: async (config) => { host.savedConfig = config as Partial<ClassqCardState> },
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

const packuData: PackuToolData = {
  spec: NODE_META.spec,
  command: {
    label: "python -m classq",
    command: "python",
    args: ["-m", "classq", "D:/archives/a.zip"],
    cwd: "D:/1VSCODE/Projects/PackU/OrganizeFolder/src",
    env: { PYTHONPATH: "D:/1VSCODE/Projects/PackU/OrganizeFolder/src" },
  },
  integration: {
    sourceRoot: "D:/1VSCODE/Projects/PackU/OrganizeFolder/src",
    moduleName: "classq",
    configCandidates: [],
    recordRun: false,
    recordFormat: "jsonl",
  },
  selectedPaths: ["D:/archives/a.zip"],
  errors: [],
}
