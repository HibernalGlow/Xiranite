// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import type { EngineVData, EngineVInput, EngineVWallpaper } from "@xiranite/node-enginev/core"
import { Component } from "./Component"

const surfaceState = vi.hoisted(() => ({
  mode: "regular" as NodeSurfaceMode,
}))

vi.mock("@/nodes/shared/useNodeSurface", () => ({
  useNodeSurface: () => ({
    ref: { current: null },
    width: widthForMode(surfaceState.mode),
    height: heightForMode(surfaceState.mode),
    mode: surfaceState.mode,
    density: surfaceState.mode === "collapsed" || surfaceState.mode === "compact" ? "tight" : "roomy",
  }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  surfaceState.mode = "regular"
})

describe("app-owned enginev Component", () => {
  test.each(["collapsed", "compact", "regular", "expanded", "workspace"] as NodeSurfaceMode[])(
    "renders the %s surface with EngineV-specific UI",
    (mode) => {
      surfaceState.mode = mode
      render(<Component compId="comp-enginev" host={createHost({ workshopPath: "D:/workshop", wallpapers: [wallpaper] })} />)

      expect(screen.getByText("EngineV")).toBeTruthy()
      if (mode === "collapsed") {
        expect(screen.queryByLabelText("Wallpaper Engine 工坊路径")).toBeNull()
        expect(screen.getByText(/1 可见/)).toBeTruthy()
        return
      }

      expect(screen.getByLabelText("Wallpaper Engine 工坊路径")).toBeTruthy()
      if (mode === "compact") {
        expect(screen.getByText("预演")).toBeTruthy()
        expect(screen.getByText("复制")).toBeTruthy()
        expect(screen.getByRole("button", { name: "筛选和选择" })).toBeTruthy()
        return
      }

      expect(screen.getByText("输入")).toBeTruthy()
      expect(screen.getByText("筛选")).toBeTruthy()
      expect(screen.getByText("写入选项")).toBeTruthy()
      expect(screen.getByRole("tab", { name: "画廊" })).toBeTruthy()
      expect(screen.getByTestId("enginev-header-toolbar")).toBeTruthy()
    },
  )

  test("runs scan through host.actions.run and renders local preview images", async () => {
    surfaceState.mode = "regular"
    const host = createHost({
      workshopPath: "D:/workshop",
      titleFilter: "Ocean",
      ratingFilter: "Everyone",
      typeFilter: "Video",
      logs: [],
    })
    render(<Component compId="comp-enginev" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "扫描工坊" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "enginev",
      input: {
        action: "scan",
        path: "D:/workshop",
        filters: {
          title: "Ocean",
          contentRating: "Everyone",
          type: "Video",
        },
        ids: undefined,
        template: undefined,
        dryRun: true,
        permanent: false,
        copyMode: false,
        targetPath: undefined,
        exportPath: undefined,
        exportFormat: "json",
        wallpapers: undefined,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.logs).toEqual(["[100%] Scan complete.", "Scan complete: 1 wallpaper(s)."])
    expect(host.localFilePaths).toContain("D:/workshop/111/preview.png")

    const image = screen.getByAltText("Ocean Loop") as HTMLImageElement
    expect(image.dataset.enginevPreview).toBe("true")
    expect(image.getAttribute("src")).toBe("http://local.test/local-files?path=D%3A%2Fworkshop%2F111%2Fpreview.png")
  })

  test("selects gallery items and copies their paths without text-only rows", async () => {
    surfaceState.mode = "expanded"
    const host = createHost({ workshopPath: "D:/workshop", wallpapers: [wallpaper] })
    render(<Component compId="comp-enginev" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "选择 Ocean Loop" }))
    expect(host.state.idsText).toBe("111")

    await user.click(screen.getByRole("button", { name: "复制 Ocean Loop 路径" }))
    expect(host.copiedText).toBe("D:/workshop/111")
  })
})

interface EngineVCardState {
  action?: EngineVInput["action"]
  workshopPath?: string
  titleFilter?: string
  ratingFilter?: string
  typeFilter?: string
  idsText?: string
  template?: string
  outputPath?: string
  exportFormat?: EngineVInput["exportFormat"]
  dryRun?: boolean
  copyMode?: boolean
  permanent?: boolean
  targetPath?: string
  phase?: string
  progress?: number
  progressText?: string
  wallpapers?: EngineVWallpaper[]
  filteredWallpapers?: EngineVWallpaper[]
  result?: EngineVData | null
  logs?: string[]
}

type TestHost = NodeHostApi & {
  state: EngineVCardState
  runCalls: Array<{ nodeId: string; input: EngineVInput }>
  copiedText: string
  localFilePaths: string[]
}

function createHost(initial: EngineVCardState): TestHost {
  const host: TestHost = {
    state: { ...initial },
    runCalls: [],
    copiedText: "",
    localFilePaths: [],
    getData: <T,>() => host.state as T,
    patchData: (_compId, patch) => {
      host.state = { ...host.state, ...patch }
    },
    listComponents: () => [],
    updateComponent: () => undefined,
    actions: {
      run: async <TInput, TData>(nodeId: string, input: TInput, onEvent?: (event: { type: "progress" | "log"; progress?: number; message: string }) => void): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as EngineVInput })
        onEvent?.({ type: "progress", progress: 100, message: "Scan complete." })
        return {
          success: true,
          message: "Scan complete: 1 wallpaper(s).",
          data: enginevData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/workshop",
      writeText: async (text) => {
        host.copiedText = text
      },
    },
    localFiles: {
      getUrl: (path) => {
        host.localFilePaths.push(path)
        return `http://local.test/local-files?path=${encodeURIComponent(path)}`
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

const wallpaper: EngineVWallpaper = {
  path: "D:/workshop/111",
  folderName: "111",
  workshopId: "111",
  title: "Ocean Loop",
  description: "calm motion",
  contentRating: "Everyone",
  ratingSex: "",
  ratingViolence: "",
  tags: ["test"],
  fileName: "scene.mp4",
  preview: "preview.png",
  wallpaperType: "Video",
  createdTime: "2026-01-01T00:00:00.000Z",
  modifiedTime: "2026-01-01T00:00:00.000Z",
  size: 1024,
  projectData: {},
}

const enginevData: EngineVData = {
  wallpapers: [wallpaper],
  filteredWallpapers: [wallpaper],
  totalCount: 1,
  filteredCount: 1,
  successCount: 0,
  failedCount: 0,
  typeStats: { Video: 1 },
  ratingStats: { Everyone: 1 },
  renameResults: [],
  deleteResults: [],
  exportPath: "",
  errors: [],
}

function widthForMode(mode: NodeSurfaceMode): number {
  if (mode === "collapsed") return 240
  if (mode === "compact") return 420
  if (mode === "regular") return 720
  if (mode === "expanded") return 920
  return 1120
}

function heightForMode(mode: NodeSurfaceMode): number {
  return mode === "workspace" ? 720 : 420
}
