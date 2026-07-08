// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import type { FindzData, FindzInput } from "@xiranite/node-findz/core"
import { Component } from "./Component"
import type { FindzCardState } from "./types"

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

describe("app-owned findz Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)(
    "renders the %s surface with Findz-specific UI",
    (mode) => {
      setSurface(mode)
      render(<Component compId="comp-findz" host={createHost({ pathText: "D:/gallery" })} />)

      expect(screen.getByText("Findz")).toBeTruthy()
      if (mode === "collapsed") {
        expect(screen.getByTestId("findz-collapsed-view")).toBeTruthy()
        expect(screen.getByText(/1 条路径等待搜索/)).toBeTruthy()
        expect(screen.queryByLabelText("findz 搜索路径")).toBeNull()
        return
      }

      expect(screen.getByLabelText("findz 搜索路径")).toBeTruthy()
      expect(screen.getByLabelText("findz SQL 过滤器")).toBeTruthy()
      expect(screen.getByTestId("findz-action-picker")).toBeTruthy()
      expect(screen.getByRole("tab", { name: "文件" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "分组" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "日志" })).toBeTruthy()

      if (mode === "compact") {
        expect(screen.getByTestId("findz-compact-view")).toBeTruthy()
        expect(screen.getByRole("button", { name: "findz 高级选项" })).toBeTruthy()
      } else if (mode === "portrait") {
        expect(screen.getByTestId("findz-portrait-view")).toBeTruthy()
        expect(screen.getByTestId("findz-primary-switches")).toBeTruthy()
      } else {
        expect(screen.getByTestId("findz-full-view")).toBeTruthy()
        expect(screen.getByText("关键开关")).toBeTruthy()
        expect(screen.getByText("任务")).toBeTruthy()
        expect(screen.getByTestId("findz-header-toolbar")).toBeTruthy()
      }
    },
  )

  test("forces collapsed content when compact surface height is too short", () => {
    setSurfaceSize({ width: 420, height: 159 })

    render(<Component compId="comp-findz" host={createHost({ pathText: "D:/gallery" })} />)

    expect(screen.getByTestId("findz-collapsed-view")).toBeTruthy()
    expect(screen.queryByLabelText("findz 搜索路径")).toBeNull()
  })

  test("uses portrait compact layout for tall compact surfaces", () => {
    setSurfaceSize({ width: 559, height: 300 })

    render(<Component compId="comp-findz" host={createHost({ pathText: "D:/gallery" })} />)

    expect(screen.getByTestId("findz-portrait-view")).toBeTruthy()
    expect(screen.queryByTestId("findz-compact-view")).toBeNull()
  })

  test("pastes scan paths from the clipboard", async () => {
    setSurface("compact")
    const host = createHost({})
    render(<Component compId="comp-findz" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "粘贴路径" }))

    expect(host.state.pathText).toBe("D:/gallery")
  })

  test("runs search through host.actions.run and stores the result in the files tab", async () => {
    setSurface("regular")
    const host = createHost({ pathText: "D:/gallery", logs: [] })
    render(<Component compId="comp-findz" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "运行搜索" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "findz",
      input: {
        action: "search",
        pathText: "D:/gallery",
        where: "1",
        noArchive: false,
        followSymlinks: false,
        withImageMeta: false,
        longFormat: true,
        continueOnError: true,
        maxResults: 0,
        maxReturnFiles: 5000,
        groupBy: undefined,
        refine: undefined,
        sortBy: "avgSize",
        sortDesc: true,
        outputFormat: "text",
        outputPath: undefined,
        archiveSeparator: "//",
        printZero: false,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.result?.totalCount).toBe(2)
    expect(host.state.logs?.at(-1)).toBe("Found 2 item(s).")
    expect(screen.getAllByText(/cover\.jpg/).length).toBeGreaterThanOrEqual(1)
  })

  test("marks the card as error when the runner returns a failed response", async () => {
    setSurface("regular")
    const host = createHost(
      { pathText: "D:/gallery", logs: [] },
      { runResult: { success: false, message: "Path not found.", data: { ...findzData, errors: ["Path not found."] } } },
    )
    render(<Component compId="comp-findz" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "运行搜索" }))

    await waitFor(() => expect(host.state.phase).toBe("error"))
    expect(host.state.progressText).toBe("Path not found.")
    expect(host.state.logs?.at(-1)).toBe("Path not found.")
  })

  test("requests filter help without requiring paths", async () => {
    setSurface("regular")
    const host = createHost({ logs: [] })
    render(<Component compId="comp-findz" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "过滤器帮助" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("help")
    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(screen.getByRole("tab", { name: "帮助" })).toBeTruthy()
  })

  test("saves, restores, and clears default config controls", async () => {
    setSurface("regular")
    const host = createHost(
      { pathText: "D:/current", where: "ext = \"jpg\"" },
      { config: { pathText: "D:/default", where: "1" } },
    )
    render(<Component compId="comp-findz" host={host} />)
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByRole("button", { name: "findz 默认配置" }).className).toContain("bg-secondary"))
    await user.click(screen.getByRole("button", { name: "findz 默认配置" }))
    await user.click(screen.getByRole("button", { name: "恢复默认" }))
    expect(host.state.pathText).toBe("D:/default")
    expect(host.state.where).toBe("1")

    await user.click(screen.getByRole("button", { name: "清除覆盖" }))
    expect(host.state.pathText).toBeUndefined()
    expect(host.state.where).toBeUndefined()

    await user.click(screen.getByRole("button", { name: "保存为默认" }))
    expect(host.savedConfig).toBeDefined()

    await user.click(screen.getByRole("button", { name: "打开文件" }))
    expect(host.openConfigFileCalls).toBe(1)
  })
})

type TestHost = NodeHostApi & {
  copiedText: string
  openConfigFileCalls: number
  runCalls: Array<{ nodeId: string; input: FindzInput }>
  savedConfig: Partial<FindzCardState> | undefined
  state: FindzCardState
}

type HostOptions = {
  config?: Partial<FindzCardState>
  runResult?: NodeRunResult<FindzData>
}

function createHost(initial: FindzCardState, options: HostOptions = {}): TestHost {
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
        host.runCalls.push({ nodeId, input: input as FindzInput })
        if (input) {
          const action = (input as FindzInput).action
          if (action === "help") {
            return {
              success: true,
              message: "findz filter help",
              data: { ...findzData, action: "help", outputText: "findz filter syntax" } as unknown as TData,
            }
          }
        }
        onEvent?.({ type: "progress", progress: 25, message: "Scanning paths." })
        onEvent?.({ type: "log", message: "Compiling filter." })
        onEvent?.({ type: "progress", progress: 100, message: "findz complete." })
        return (options.runResult ?? {
          success: true,
          message: "Found 2 item(s).",
          data: findzData,
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
    getNodeConfig: async <T,>() => ({ config: options.config as T | undefined, path: "D:/config/xiranite.config.toml" }),
    saveNodeConfig: async (config) => {
      host.savedConfig = config as Partial<FindzCardState>
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

const findzData: FindzData = {
  action: "search",
  totalCount: 2,
  fileCount: 2,
  dirCount: 0,
  archiveCount: 0,
  nestedCount: 0,
  files: [
    {
      name: "cover.jpg",
      path: "D:/gallery/cover.jpg",
      size: 1024,
      sizeFormatted: "1K",
      modTime: "2024-01-01T00:00:00.000Z",
      date: "2024-01-01",
      time: "00:00:00",
      type: "file",
      container: "",
      archive: "",
      ext: "jpg",
      ext2: "jpg",
    },
    {
      name: "image-a.jpg",
      path: "D:/gallery/image-a.jpg",
      size: 2048,
      sizeFormatted: "2K",
      modTime: "2024-01-02T00:00:00.000Z",
      date: "2024-01-02",
      time: "00:00:00",
      type: "file",
      container: "",
      archive: "",
      ext: "jpg",
      ext2: "jpg",
    },
  ],
  groups: [],
  byExtension: { jpg: 2 },
  byArchive: {},
  errors: [],
  paths: ["D:/gallery"],
  where: "1",
  scannedFiles: 2,
  elapsedMs: 12,
  truncated: false,
  returnedCount: 2,
}
