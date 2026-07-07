// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import type { BandiaAction, BandiaData, BandiaInput } from "@xiranite/node-bandia/core"
import { Component } from "./Component"
import type { BandiaCardState } from "./types"

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

describe("app-owned bandia Component", () => {
  test.each(["collapsed", "compact", "portrait", "regular", "expanded", "workspace"] as NodeSurfaceMode[])(
    "renders the %s surface with Bandia-specific UI",
    (mode) => {
      surfaceState.mode = mode
      render(<Component compId="comp-bandia" host={createHost({ pathText: "D:/archives/book.zip" })} />)

      expect(screen.getByText("Bandia")).toBeTruthy()
      if (mode === "collapsed") {
        expect(screen.getByText(/1 个归档/)).toBeTruthy()
        expect(screen.queryByLabelText("压缩包路径")).toBeNull()
        return
      }

      expect(screen.getByLabelText("压缩包路径")).toBeTruthy()
      if (mode === "compact" || mode === "portrait") {
        if (mode === "portrait") {
          expect(screen.getByRole("tab", { name: "结果" })).toBeTruthy()
          expect(screen.getByRole("tab", { name: "日志" })).toBeTruthy()
        }
        expect(screen.getByRole("button", { name: "批量解压" })).toBeTruthy()
        expect(screen.getByRole("button", { name: "预演解压" })).toBeTruthy()
        return
      }

      expect(screen.getByText("任务")).toBeTruthy()
      expect(screen.getByText("关键开关")).toBeTruthy()
      expect(screen.getByRole("tab", { name: "结果" })).toBeTruthy()
      expect(screen.getByTestId("bandia-header-toolbar")).toBeTruthy()
    },
  )

  test("keeps result and log tabs visible in portrait cards", () => {
    surfaceState.mode = "portrait"
    render(<Component compId="comp-bandia" host={createHost({ pathText: "D:/archives/book.zip", logs: ["ready"] })} />)

    expect(screen.getByLabelText("压缩包路径")).toBeTruthy()
    expect(screen.getByRole("tab", { name: "结果" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "日志" })).toBeTruthy()
  })

  test("pastes clipboard input into component state", async () => {
    surfaceState.mode = "compact"
    const host = createHost({})
    render(<Component compId="comp-bandia" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "粘贴输入" }))

    expect(host.state.pathText).toBe("D:/archives/book.zip")
  })

  test("runs compress mode with real source paths and copies results", async () => {
    surfaceState.mode = "regular"
    const host = createHost({
      mode: "compress",
      pathText: "D:/books/source folder",
      outputDir: "D:/archives",
      dryRun: true,
      logs: [],
    })
    render(<Component compId="comp-bandia" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "预演压缩" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "bandia",
      input: {
        action: "compress",
        paths: ["D:/books/source folder"],
        mappings: [],
        mappingText: undefined,
        deleteAfter: true,
        useTrash: true,
        parallel: false,
        workers: 2,
        extractMode: "auto",
        outputPrefix: "[extract] ",
        overwriteMode: "overwrite",
        outputDir: "D:/archives",
        compressFormat: "zip",
        deleteSource: true,
        dryRun: true,
        openInEverything: false,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.result?.compressedCount).toBe(1)
    expect(host.state.logs).toEqual(["Compress complete: 1 succeeded, 0 failed."])
    expect(screen.getByText(/ok D:\/books\/source folder -> D:\/archives\/source folder\.zip/)).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "复制结果" }))
    expect(host.copiedText).toBe("ok D:/books/source folder -> D:/archives/source folder.zip")
  })
})

type TestHost = NodeHostApi & {
  state: BandiaCardState
  runCalls: Array<{ nodeId: string; input: BandiaInput }>
  copiedText: string
}

function createHost(initial: BandiaCardState): TestHost {
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
        host.runCalls.push({ nodeId, input: input as BandiaInput })
        onEvent?.({ type: "progress", progress: 100, message: "compress complete." })
        return {
          success: true,
          message: "Compress complete: 1 succeeded, 0 failed.",
          data: bandiaData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/archives/book.zip",
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

const bandiaData: BandiaData = {
  action: "compress" as BandiaAction,
  extractedCount: 0,
  compressedCount: 1,
  failedCount: 0,
  totalCount: 1,
  exportedCount: 0,
  pathMappings: [],
  results: [
    {
      kind: "compress",
      sourcePath: "D:/books/source folder",
      archivePath: "D:/archives/source folder.zip",
      success: true,
      durationMs: 0,
      command: 'bz a -y "D:/archives/source folder.zip" "source folder"',
      skipped: true,
    },
  ],
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
  if (mode === "compact") return 260
  if (mode === "portrait") return 640
  if (mode === "expanded") return 560
  if (mode === "workspace") return 720
  return 420
}
