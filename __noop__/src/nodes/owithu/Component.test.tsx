// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import type { OwithuData, OwithuInput } from "@xiranite/node-owithu/core"
import { Component } from "./Component"
import type { OwithuCardState } from "./types"

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

describe("app-owned owithu Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)(
    "renders the %s surface with Owithu-specific UI",
    (mode) => {
      setSurface(mode)
      render(<Component compId="comp-owithu" host={createHost({ path: "D:/config/owithu.toml" })} />)

      expect(screen.getByText("Owithu")).toBeTruthy()
      if (mode === "collapsed") {
        expect(screen.getByTestId("owithu-collapsed-view")).toBeTruthy()
        expect(screen.getByText(/D:\/config\/owithu\.toml 等待运行/)).toBeTruthy()
        expect(screen.queryByLabelText("owithu 配置文件路径")).toBeNull()
        return
      }

      expect(screen.getByLabelText("owithu 配置文件路径")).toBeTruthy()
      expect(screen.getByTestId("owithu-action-picker")).toBeTruthy()
      expect(screen.getByRole("tab", { name: "计划" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "条目" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "日志" })).toBeTruthy()

      if (mode === "compact") {
        expect(screen.getByTestId("owithu-compact-view")).toBeTruthy()
        expect(screen.getByRole("button", { name: "owithu 高级选项" })).toBeTruthy()
      } else if (mode === "portrait") {
        expect(screen.getByTestId("owithu-portrait-view")).toBeTruthy()
        expect(screen.getByLabelText("owithu TOML 配置")).toBeTruthy()
      } else {
        expect(screen.getByTestId("owithu-full-view")).toBeTruthy()
        expect(screen.getByText("TOML 配置")).toBeTruthy()
        expect(screen.getByText("任务")).toBeTruthy()
        expect(screen.getByTestId("owithu-header-toolbar")).toBeTruthy()
      }
    },
  )

  test("forces collapsed content when compact surface height is too short", () => {
    setSurfaceSize({ width: 420, height: 159 })

    render(<Component compId="comp-owithu" host={createHost({ path: "D:/config/owithu.toml" })} />)

    expect(screen.getByTestId("owithu-collapsed-view")).toBeTruthy()
    expect(screen.queryByLabelText("owithu 配置文件路径")).toBeNull()
  })

  test("uses portrait compact layout for tall compact surfaces", () => {
    setSurfaceSize({ width: 559, height: 300 })

    render(<Component compId="comp-owithu" host={createHost({ path: "D:/config/owithu.toml" })} />)

    expect(screen.getByTestId("owithu-portrait-view")).toBeTruthy()
    expect(screen.queryByTestId("owithu-compact-view")).toBeNull()
  })

  test("pastes a directory path from the clipboard", async () => {
    setSurface("compact")
    const host = createHost({})
    render(<Component compId="comp-owithu" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "粘贴路径" }))

    expect(host.state.path).toBe("D:/config/owithu.toml")
  })

  test("runs preview locally when configText is provided without calling host.actions.run", async () => {
    setSurface("regular")
    const host = createHost({ configText: SAMPLE_TOML, action: "preview", logs: [] })
    render(<Component compId="comp-owithu" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "运行预览" }))

    expect(host.runCalls).toHaveLength(0)
    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.result?.entries.length).toBe(1)
    expect(host.state.result?.plan.length).toBe(1)
    expect(host.state.logs?.at(-1)).toBe("Found 1 entries and 1 registry operations.")
  })

  test("requires AlertDialog confirmation before executing the destructive register action", async () => {
    setSurface("regular")
    const host = createHost({ configText: SAMPLE_TOML, action: "register", logs: [] })
    render(<Component compId="comp-owithu" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "运行注册" }))
    expect(host.runCalls).toHaveLength(0)

    expect(screen.getByText("确认真实执行 Owithu？")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "确认执行" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("register")
    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(screen.getAllByText(/open-with-app/).length).toBeGreaterThanOrEqual(1)
  })

  test("marks the card as error when the runner returns a failed response", async () => {
    setSurface("regular")
    const host = createHost(
      { path: "D:/config/owithu.toml", action: "preview", logs: [] },
      { runResult: { success: false, message: "Config file not found.", data: { ...owithuData, errors: ["Config file not found."] } } },
    )
    render(<Component compId="comp-owithu" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "运行预览" }))

    await waitFor(() => expect(host.state.phase).toBe("error"))
    expect(host.state.progressText).toBe("Config file not found.")
    expect(host.state.logs?.at(-1)).toBe("Config file not found.")
  })

  test("saves, restores, and clears default config controls", async () => {
    setSurface("regular")
    const host = createHost(
      { path: "D:/current", action: "preview", hive: "HKCU" },
      { config: { path: "D:/default", action: "register", hive: "" } },
    )
    render(<Component compId="comp-owithu" host={host} />)
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByRole("button", { name: "owithu 默认配置" }).className).toContain("bg-secondary"))
    await user.click(screen.getByRole("button", { name: "owithu 默认配置" }))
    await user.click(screen.getByRole("button", { name: "恢复默认" }))
    expect(host.state.path).toBe("D:/default")
    expect(host.state.action).toBe("register")
    expect(host.state.hive).toBe("")

    await user.click(screen.getByRole("button", { name: "清除覆盖" }))
    expect(host.state.path).toBeUndefined()
    expect(host.state.action).toBeUndefined()
    expect(host.state.hive).toBeUndefined()

    await user.click(screen.getByRole("button", { name: "保存为默认" }))
    expect(host.savedConfig).toBeDefined()

    await user.click(screen.getByRole("button", { name: "打开文件" }))
    expect(host.openConfigFileCalls).toBe(1)
  })
})

type TestHost = NodeHostApi & {
  copiedText: string
  openConfigFileCalls: number
  runCalls: Array<{ nodeId: string; input: OwithuInput }>
  savedConfig: Partial<OwithuCardState> | undefined
  state: OwithuCardState
}

type HostOptions = {
  config?: Partial<OwithuCardState>
  runResult?: NodeRunResult<OwithuData>
}

function createHost(initial: OwithuCardState, options: HostOptions = {}): TestHost {
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
        host.runCalls.push({ nodeId, input: input as OwithuInput })
        onEvent?.({ type: "progress", progress: 25, message: "Parsing TOML config." })
        onEvent?.({ type: "log", message: "Built registry plan." })
        onEvent?.({ type: "progress", progress: 100, message: "owithu complete." })
        return (options.runResult ?? {
          success: true,
          message: "Found 1 entries and 1 registry operations.",
          data: owithuData,
        }) as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/config/owithu.toml",
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
      host.savedConfig = config as Partial<OwithuCardState>
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

const SAMPLE_TOML = `[vars]
app = 'D:\\Tools\\app.exe'

[[entries]]
key = "open-with-app"
label = "用 App 打开"
exe = "{app}"
args = ["%1"]
scope = ["file"]
`

const owithuData: OwithuData = {
  vars: { app: "D:\\Tools\\app.exe" },
  defaults: { enabled: true },
  entries: [
    {
      key: "open-with-app",
      label: "用 App 打开",
      exe: "D:\\Tools\\app.exe",
      args: ["%1"],
      icon: "D:\\Tools\\app.exe",
      scope: ["file"],
      enabled: true,
    },
  ],
  plan: [
    {
      entryKey: "open-with-app",
      hive: "HKCU",
      scope: "file",
      registryPath: "HKCU\\Software\\Classes\\*\\shell\\open-with-app",
      label: "用 App 打开",
      icon: "D:\\Tools\\app.exe",
      command: '"D:\\Tools\\app.exe" "%1"',
      enabled: true,
    },
  ],
  registeredCount: 1,
  unregisteredCount: 0,
  failedCount: 0,
  errors: [],
}
