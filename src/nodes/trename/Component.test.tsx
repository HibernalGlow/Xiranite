// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import type { TrenameData, TrenameInput } from "@xiranite/node-trename/core"
import { Component } from "./Component"
import type { TrenameCardState } from "./types"

const surfaceState = vi.hoisted(() => ({
  mode: "regular" as NodeSurfaceMode,
  height: undefined as number | undefined,
}))

vi.mock("@/nodes/shared/useNodeSurface", () => ({
  useNodeSurface: () => ({
    ref: { current: null },
    width: widthForMode(surfaceState.mode),
    height: surfaceState.height ?? heightForMode(surfaceState.mode),
    mode: surfaceState.mode,
    density: surfaceState.mode === "collapsed" || surfaceState.mode === "compact" || surfaceState.mode === "portrait" ? "tight" : "roomy",
  }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  surfaceState.mode = "regular"
  surfaceState.height = undefined
})

describe("app-owned trename Component", () => {
  test.each(["collapsed", "compact", "portrait", "regular", "expanded", "workspace"] as NodeSurfaceMode[])(
    "renders the %s surface with Trename-specific UI",
    (mode) => {
      surfaceState.mode = mode
      render(<Component compId="comp-trename" host={createHost({ pathText: "D:/gallery" })} />)

      expect(screen.getByText("Trename")).toBeTruthy()
      if (mode === "collapsed") {
        expect(screen.getByText(/1 条路径等待扫描/)).toBeTruthy()
        expect(screen.queryByLabelText("trename scan paths")).toBeNull()
        return
      }

      expect(screen.getByLabelText("trename scan paths")).toBeTruthy()
      expect(screen.getByRole("tab", { name: /文件/ })).toBeTruthy()
      expect(screen.getByRole("tab", { name: /计划/ })).toBeTruthy()
      expect(screen.getByRole("tab", { name: /冲突/ })).toBeTruthy()
      if (mode === "regular" || mode === "expanded" || mode === "workspace") {
        expect(screen.getByText("关键开关")).toBeTruthy()
        expect(screen.getByTestId("trename-header-toolbar")).toBeTruthy()
      }
    },
  )

  test("pastes scan paths from the clipboard", async () => {
    surfaceState.mode = "compact"
    const host = createHost({})
    render(<Component compId="comp-trename" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "粘贴路径" }))

    expect(host.state.pathText).toBe("D:/gallery")
  })

  test("runs scan through host.actions.run and stores JSON in the file tab", async () => {
    surfaceState.mode = "regular"
    const host = createHost({ pathText: "D:/gallery", includeRoot: true, compact: true, dryRun: true, logs: [] })
    render(<Component compId="comp-trename" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "扫描路径" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "trename",
      input: {
        action: "scan",
        paths: "D:/gallery",
        includeHidden: false,
        includeRoot: true,
        excludeExts: undefined,
        excludePatterns: undefined,
        maxLines: 1000,
        compact: true,
        mode: "normal",
        jsonContent: "",
        basePath: undefined,
        dryRun: true,
        batchId: undefined,
        undoPath: undefined,
        keepRecent: 10,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.jsonText).toContain("image-a.jpg")
    expect(host.state.logs).toEqual(["[100%] Scan complete.", "Scan complete: 2 item(s), 1 segment(s)."])
    expect(screen.getAllByText(/image-a\.jpg/).length).toBeGreaterThanOrEqual(1)
  })

  test("uses confirmation for real rename", async () => {
    surfaceState.mode = "regular"
    const host = createHost({ jsonText: jsonContent, dryRun: false })
    render(<Component compId="comp-trename" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "真实重命名" }))
    expect(screen.getByText("确认真实执行 Trename？")).toBeTruthy()

    await user.click(screen.getByText("确认执行"))
    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("rename")
    expect(host.runCalls[0]?.input.dryRun).toBe(false)
  })
})

type TestHost = NodeHostApi & {
  state: TrenameCardState
  runCalls: Array<{ nodeId: string; input: TrenameInput }>
  copiedText: string
}

function createHost(initial: TrenameCardState): TestHost {
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
      run: async <TInput, TData>(nodeId: string, input: TInput, onEvent?: (event: { type: "progress" | "log"; progress?: number; message: string }) => void): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as TrenameInput })
        onEvent?.({ type: "progress", progress: 100, message: "Scan complete." })
        return {
          success: true,
          message: "Scan complete: 2 item(s), 1 segment(s).",
          data: trenameData,
        } as NodeRunResult<TData>
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
    getNodeConfig: async () => ({ config: undefined, path: "D:/config/xiranite.config.toml" }),
    saveNodeConfig: async () => undefined,
  }
  return host
}

const jsonContent = `{
  "root": [
    {"src_dir": "gallery", "tgt_dir": "画廊", "children": [
      {"src": "image-a.jpg", "tgt": "图-a.jpg"}
    ]}
  ]
}`

const trenameData: TrenameData = {
  jsonContent,
  segments: [jsonContent],
  totalItems: 2,
  pendingCount: 0,
  readyCount: 2,
  successCount: 0,
  failedCount: 0,
  skippedCount: 0,
  operationId: "",
  conflicts: [],
  operations: [
    {
      originalPath: "D:/gallery/image-a.jpg",
      newPath: "D:/gallery/图-a.jpg",
    },
  ],
  history: [],
  basePath: "D:/",
  errors: [],
}

function widthForMode(mode: NodeSurfaceMode): number {
  if (mode === "collapsed") return 240
  if (mode === "compact") return 420
  if (mode === "portrait") return 390
  if (mode === "regular") return 720
  if (mode === "expanded") return 920
  return 1120
}

function heightForMode(mode: NodeSurfaceMode): number {
  if (mode === "collapsed") return 120
  if (mode === "compact") return 280
  if (mode === "portrait") return 640
  if (mode === "expanded") return 560
  if (mode === "workspace") return 720
  return 420
}
