// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import type { EnvuConfigData, EnvuConfigInput } from "@xiranite/node-envuconfig/core"
import { Component } from "./Component"
import type { EnvuConfigCardState } from "./types"

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

describe("app-owned envuconfig Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)(
    "renders the %s surface with EnvU-specific UI",
    (mode) => {
      setSurface(mode)
      render(<Component compId="comp-envuconfig" host={createHost({ root: "D:/EnvU" })} />)

      expect(screen.getByText("EnvU Config")).toBeTruthy()
      if (mode === "collapsed") {
        expect(screen.getByTestId("envuconfig-collapsed-view")).toBeTruthy()
        expect(screen.queryByLabelText("envuconfig 根目录")).toBeNull()
        return
      }

      expect(screen.getByLabelText("envuconfig 根目录")).toBeTruthy()
      expect(screen.getByRole("tab", { name: "文件" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "操作" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "日志" })).toBeTruthy()

      if (mode === "compact") {
        expect(screen.getByTestId("envuconfig-compact-view")).toBeTruthy()
      } else if (mode === "portrait") {
        expect(screen.getByTestId("envuconfig-portrait-view")).toBeTruthy()
      } else {
        expect(screen.getByTestId("envuconfig-full-view")).toBeTruthy()
        expect(screen.getByTestId("envuconfig-header-toolbar")).toBeTruthy()
        expect(screen.getByText("根目录")).toBeTruthy()
        expect(screen.getAllByText("包含规则").length).toBeGreaterThanOrEqual(1)
        expect(screen.getByText("路径")).toBeTruthy()
        expect(screen.getByText("运行")).toBeTruthy()
      }
    },
  )

  test("runs scan through host.runner.run and stores file results", async () => {
    setSurface("regular")
    const host = createHost({
      action: "scan",
      root: "D:/EnvU",
      dryRun: true,
      logs: [],
    })
    render(<Component compId="comp-envuconfig" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "扫描配置" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "envuconfig",
      input: {
        action: "scan",
        root: "D:/EnvU",
        include: undefined,
        backupDir: undefined,
        manifestName: undefined,
        databasePath: undefined,
        dryRun: true,
        recordRun: false,
      },
    })
    await waitFor(() => expect(host.cardState.phase).toBe("completed"))
    expect(host.cardState.result?.files).toHaveLength(1)

    await user.click(screen.getByRole("tab", { name: "文件" }))
    expect(screen.getAllByText(/config\/app\.toml/).length).toBeGreaterThanOrEqual(1)
  })

  test("requires confirmation before real backup execution", async () => {
    setSurface("regular")
    const host = createHost({ action: "backup", root: "D:/EnvU", backupDir: "D:/backup/envu", dryRun: false, logs: [] })
    render(<Component compId="comp-envuconfig" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "执行备份" }))
    expect(host.runCalls).toHaveLength(0)
    expect(screen.getByText("确认执行备份？")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "确认备份" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("backup")
    expect(host.runCalls[0]?.input.dryRun).toBe(false)
  })

  test("marks the card as error when no root is provided", async () => {
    setSurface("regular")
    const host = createHost({ logs: [] })
    render(<Component compId="comp-envuconfig" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "扫描配置" }))

    expect(host.runCalls).toHaveLength(0)
    await waitFor(() => expect(host.cardState.phase).toBe("error"))
    expect(host.cardState.progressText).toContain("根目录")
  })
})

type TestHost = NodeHostApi<EnvuConfigCardState, Partial<EnvuConfigCardState>> & {
  copiedText: string
  runCalls: Array<{ nodeId: string; input: EnvuConfigInput }>
  savedConfig: Partial<EnvuConfigCardState> | undefined
  cardState: EnvuConfigCardState
}

function createHost(initial: EnvuConfigCardState): TestHost {
  const stateCapability = {
    getData: () => host.cardState,
    patchData: (patch: Partial<EnvuConfigCardState>) => {
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
        host.runCalls.push({ nodeId, input: input as EnvuConfigInput })
        onEvent?.({ type: "progress", progress: 50, message: "Scanning EnvU files." })
        return {
          success: true,
          message: "Found 1 EnvU config file(s).",
          data: envuconfigData as TData,
        }
      },
    },
    clipboard: {
      readText: async () => "D:/EnvU",
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
      host.savedConfig = config as Partial<EnvuConfigCardState>
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

const envuconfigData: EnvuConfigData = {
  files: [
    { path: "D:/EnvU/config/app.toml", relativePath: "config/app.toml", group: "config", size: 1024, modifiedMs: 0 },
  ],
  operations: [],
  manifestPath: "",
  fileCount: 1,
  totalSize: 1024,
  errors: [],
}
