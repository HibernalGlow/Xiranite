// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import type { LataData, LataInput } from "@xiranite/node-lata/core"
import { Component } from "./Component"
import type { LataCardState } from "./types"

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

describe("app-owned lata Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)(
    "renders the %s surface with Lata-specific UI",
    (mode) => {
      setSurface(mode)
      render(<Component compId="comp-lata" host={createHost({ taskfilePath: "D:/repo/Taskfile.yml", result: lataData, logs: [] })} />)

      expect(screen.getByText("Lata")).toBeTruthy()
      if (mode === "collapsed") {
        expect(screen.getByTestId("lata-collapsed-view")).toBeTruthy()
        expect(screen.queryByTestId("lata-task-picker")).toBeNull()
        return
      }

      expect(screen.getByTestId("lata-taskfile-input")).toBeTruthy()
      expect(screen.getByTestId("lata-task-picker")).toBeTruthy()
      expect(screen.getByRole("tab", { name: "任务" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "命令" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "日志" })).toBeTruthy()

      if (mode === "compact") {
        expect(screen.getByTestId("lata-compact-view")).toBeTruthy()
      } else if (mode === "portrait") {
        expect(screen.getByTestId("lata-portrait-view")).toBeTruthy()
      } else {
        expect(screen.getByTestId("lata-full-view")).toBeTruthy()
        expect(screen.getByTestId("lata-header-toolbar")).toBeTruthy()
      }
    },
  )

  test("forces collapsed content when compact surface height is too short", () => {
    setSurfaceSize({ width: 420, height: 159 })

    render(<Component compId="comp-lata" host={createHost({ taskfilePath: "D:/repo/Taskfile.yml", logs: [] })} />)

    expect(screen.getByTestId("lata-collapsed-view")).toBeTruthy()
    expect(screen.queryByTestId("lata-task-picker")).toBeNull()
  })

  test("uses portrait compact layout for tall compact surfaces", () => {
    setSurfaceSize({ width: 559, height: 300 })

    render(<Component compId="comp-lata" host={createHost({ taskfilePath: "D:/repo/Taskfile.yml", logs: [] })} />)

    expect(screen.getByTestId("lata-portrait-view")).toBeTruthy()
    expect(screen.queryByTestId("lata-compact-view")).toBeNull()
  })

  test("loads tasks through host.actions.run and stores the task list", async () => {
    setSurface("regular")
    const host = createHost({ taskfilePath: "D:/repo/Taskfile.yml", logs: [] })
    render(<Component compId="comp-lata" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "加载任务" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "lata",
      input: {
        action: "list",
        taskfilePath: "D:/repo/Taskfile.yml",
        taskName: "",
        taskArgs: undefined,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.result?.tasks).toEqual(lataData.tasks)
  })

  test("plans commands through host.actions.run and shows the plan", async () => {
    setSurface("regular")
    const host = createHost({ taskfilePath: "D:/repo/Taskfile.yml", taskName: "hello", taskArgs: "world", result: lataData, logs: [] })
    render(<Component compId="comp-lata" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "预览命令" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("plan")
    expect(host.runCalls[0]?.input.taskName).toBe("hello")
    expect(host.runCalls[0]?.input.taskArgs).toBe("world")

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.result?.commandPlan).toEqual(lataData.commandPlan)
  })

  test("uses confirmation dialog for execute action", async () => {
    setSurface("regular")
    const host = createHost({ taskfilePath: "D:/repo/Taskfile.yml", taskName: "hello", result: lataData, logs: [] })
    render(<Component compId="comp-lata" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "执行任务" }))
    expect(screen.getByText("确认执行 Lata 任务？")).toBeTruthy()

    await user.click(screen.getByText("确认执行"))
    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("execute")
  })

  test("pastes Taskfile path from clipboard", async () => {
    setSurface("regular")
    const host = createHost({ logs: [] })
    render(<Component compId="comp-lata" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "粘贴 Taskfile 路径" }))

    expect(host.state.taskfilePath).toBe("D:/repo/Taskfile.yml")
  })

  test("marks the card as error when the runner returns a failed response", async () => {
    setSurface("regular")
    const host = createHost(
      { taskfilePath: "D:/repo/Taskfile.yml", taskName: "hello", logs: [] },
      { runResult: { success: false, message: "Task not found: missing.", data: { ...lataData, errors: ["Task not found: missing"] } } },
    )
    render(<Component compId="comp-lata" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "预览命令" }))

    await waitFor(() => expect(host.state.phase).toBe("error"))
    expect(host.state.progressText).toBe("Task not found: missing.")
  })

  test("catches thrown runner errors and appends the message to logs", async () => {
    setSurface("regular")
    const host = createHost({ taskfilePath: "D:/repo/Taskfile.yml", taskName: "hello", logs: [] }, { runError: new Error("backend offline") })
    render(<Component compId="comp-lata" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "预览命令" }))

    await waitFor(() => expect(host.state.phase).toBe("error"))
    expect(host.state.progressText).toBe("backend offline")
    expect(host.state.logs?.at(-1)).toBe("backend offline")
  })

  test("saves, restores, clears, and opens default config controls", async () => {
    setSurface("regular")
    const host = createHost(
      { taskfilePath: "D:/repo/Taskfile.yml", taskName: "hello", taskArgs: "world" },
      { config: { taskfilePath: "D:/other/Taskfile.yml", taskName: "build", taskArgs: "" } },
    )
    render(<Component compId="comp-lata" host={host} />)
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByRole("button", { name: "lata defaults" }).className).toContain("bg-secondary"))
    await user.click(screen.getByRole("button", { name: "lata defaults" }))
    await user.click(screen.getByRole("button", { name: "恢复默认" }))
    expect(host.state.taskfilePath).toBe("D:/other/Taskfile.yml")
    expect(host.state.taskName).toBe("build")

    await user.click(screen.getByRole("button", { name: "清除覆盖" }))
    expect(host.state.taskfilePath).toBeUndefined()
    expect(host.state.taskName).toBeUndefined()

    await user.click(screen.getByRole("button", { name: "保存为默认" }))
    expect(host.savedConfig).toEqual({})

    await user.click(screen.getByRole("button", { name: "打开文件" }))
    expect(host.openConfigFileCalls).toBe(1)
  })
})

type TestHost = NodeHostApi & {
  openConfigFileCalls: number
  runCalls: Array<{ nodeId: string; input: LataInput }>
  savedConfig: Partial<LataCardState> | undefined
  state: LataCardState
}

type HostOptions = {
  config?: Partial<LataCardState>
  runError?: Error
  runResult?: NodeRunResult<LataData>
}

function createHost(initial: LataCardState, options: HostOptions = {}): TestHost {
  const host: TestHost = {
    state: { ...initial },
    runCalls: [],
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
        host.runCalls.push({ nodeId, input: input as LataInput })
        if (options.runError) throw options.runError
        const action = (input as LataInput).action ?? "list"
        if (action === "list") {
          onEvent?.({ type: "progress", progress: 100, message: "Found 1 task(s)." })
          return (options.runResult ?? {
            success: true,
            message: "Found 1 task(s).",
            data: lataData,
          }) as NodeRunResult<TData>
        }
        if (action === "plan") {
          onEvent?.({ type: "progress", progress: 100, message: "echo hello world" })
          return (options.runResult ?? {
            success: true,
            message: "Planned 1 command(s) for hello.",
            data: { ...lataData, commandPlan: lataData.commandPlan },
          }) as NodeRunResult<TData>
        }
        onEvent?.({ type: "progress", progress: 50, message: "echo hello world" })
        onEvent?.({ type: "log", message: "hello world" })
        onEvent?.({ type: "progress", progress: 100, message: "Task completed." })
        return (options.runResult ?? {
          success: true,
          message: "Task 'hello' completed.",
          data: { ...lataData, commandResults: [{ ...lataData.commandPlan[0]!, exitCode: 0, stdout: "hello world", stderr: "" }], exitCode: 0 },
        }) as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/repo/Taskfile.yml",
      writeText: async () => undefined,
    },
    env: {
      theme: "light",
      platform: "web",
    },
    getNodeConfig: async <T,>() => ({ config: options.config as T | undefined, path: "D:/config/xiranite.config.toml" }),
    saveNodeConfig: async (config) => {
      host.savedConfig = config as Partial<LataCardState>
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

const lataData: LataData = {
  taskfilePath: "D:/repo/Taskfile.yml",
  tasks: [
    {
      name: "hello",
      desc: "Say hello",
      prompt: null,
      cmds: ["echo hello {{.CLI_ARGS}}"],
      cmdCount: 1,
      silent: false,
      vars: {},
      deps: [],
      sources: [],
      generates: [],
    },
  ],
  selectedTask: "hello",
  commandPlan: [
    {
      taskName: "hello",
      command: "echo hello world",
      index: 0,
    },
  ],
  commandResults: [],
  exitCode: 0,
  errors: [],
}
