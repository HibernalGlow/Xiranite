// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { XlchemyData, XlchemyInput } from "@xiranite/node-xlchemy/core"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import { Component } from "./Component"
import type { XlchemyCardState } from "./types"

const surfaceState = vi.hoisted(() => ({ height: 420, width: 720 }))
vi.mock("@/nodes/shared/useNodeSurface", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/nodes/shared/useNodeSurface")>()
  return { ...actual, useNodeSurface: () => { const mode = actual.resolveNodeSurfaceMode(surfaceState); return { ref: { current: null }, ...surfaceState, mode, density: actual.resolveNodeSurfaceDensity(mode) } } }
})

afterEach(() => { cleanup(); vi.clearAllMocks(); setSurface("regular") })

describe("app-owned xlchemy Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)("renders the %s surface", (mode) => {
    setSurface(mode)
    render(<Component compId="xlchemy-card" host={createHost({ pathsText: "D:/images/a.png" })} />)
    expect(screen.getByText("Xlchemy")).toBeTruthy()
    expect(screen.getByTestId(`xlchemy-${mode === "regular" || mode === "expanded" || mode === "workspace" ? "full" : mode}-view`)).toBeTruthy()
    if (mode !== "collapsed") {
      expect(screen.getByTestId("xlchemy-input-workbench")).toBeTruthy()
      expect(screen.getAllByRole("button", { name: "添加文件" }).length).toBeGreaterThan(0)
      expect(screen.getByRole("radio", { name: "文件树视图" })).toBeTruthy()
      expect(screen.getByRole("radio", { name: "列表视图" })).toBeTruthy()
      expect(screen.getByTestId("xlchemy-progress-workbench")).toBeTruthy()
      expect(screen.getByRole("tab", { name: "参数" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "文件" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "输入分析" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "输出分析" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "结果" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "问题" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "日志" })).toBeTruthy()
    }
  })

  test("uses quality 60 by default and exposes only global presets", async () => {
    const host = createHost({ pathsText: "D:/images/a.png", lossless: true })
    render(<Component compId="xlchemy-card" host={host} />)
    const user = userEvent.setup()

    expect(screen.getAllByRole("slider")[0]?.getAttribute("aria-valuenow")).toBe("60")
    expect(screen.getByRole("group", { name: "压缩模式" })).toBeTruthy()
    expect(screen.getByRole("radio", { name: "无损" }).getAttribute("aria-checked")).toBe("true")
    expect(screen.queryByText("Alpha")).toBeNull()
    expect(screen.queryByText("Beta")).toBeNull()
    expect(screen.queryByText("Gamma")).toBeNull()

    await user.click(screen.getByRole("button", { name: "预览计划" }))
    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toMatchObject({ nodeId: "xlchemy", input: { action: "plan", paths: ["D:/images/a.png"], quality: 60 } })
  })

  test("creates, renames, overwrites and deletes custom presets through the database preset capability", async () => {
    const host = createHost({ pathsText: "D:/images/a.png", format: "WebP", lossless: false, quality: 77, effort: 5 })
    const view = render(<Component compId="xlchemy-card" host={host} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "配置管理" }))
    await user.click(screen.getByRole("button", { name: "新建预设" }))
    await user.type(screen.getByLabelText("预设名称"), "Archive")
    await user.click(screen.getByRole("button", { name: "创建" }))
    await waitFor(() => expect(host.presets).toMatchObject([{ name: "Archive", values: { format: "WebP", quality: 77, effort: 5 } }]))

    await user.click(screen.getByRole("combobox", { name: "预设" }))
    await user.click(screen.getByRole("option", { name: "Archive" }))
    expect(host.cardState.selectedPreset).toBe(host.presets[0]?.id)
    host.cardState = { ...host.cardState, quality: 25 }
    view.rerender(<Component compId="xlchemy-card" host={host} />)
    await user.click(screen.getByRole("button", { name: "应用预设" }))
    expect(host.cardState.quality).toBe(77)
    await user.click(screen.getByRole("button", { name: "查看预设配置" }))
    expect(screen.getByText(/"quality": 77/)).toBeTruthy()
    await user.keyboard("{Escape}")
    await user.click(screen.getAllByRole("button", { name: "重命名" }).at(-1)!)
    const nameInput = screen.getByLabelText("预设名称")
    await user.clear(nameInput)
    await user.type(nameInput, "Archive v2")
    await user.click(screen.getAllByRole("button", { name: "重命名" }).at(-1)!)
    await waitFor(() => expect(host.presets[0]?.name).toBe("Archive v2"))

    await user.click(screen.getByRole("button", { name: "保存当前到预设" }))
    await user.click(screen.getAllByRole("button", { name: "保存当前到预设" }).at(-1)!)
    await waitFor(() => expect(host.presets[0]?.values.quality).toBe(77))
    await user.click(screen.getByRole("button", { name: "删除预设" }))
    await user.click(screen.getAllByRole("button", { name: "删除预设" }).at(-1)!)
    await waitFor(() => expect(host.presets).toEqual([]))
  })

  test("keeps config inspection and factory restore available before saved defaults exist", async () => {
    const host = createHost({ pathsText: "D:/images/a.png", format: "WebP", quality: 22, recursive: false })
    const view = render(<Component compId="xlchemy-card" host={host} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "配置管理" }))

    const viewConfig = screen.getByRole("button", { name: "查看配置" })
    const restore = screen.getByRole("button", { name: "恢复默认" })
    expect(viewConfig.hasAttribute("disabled")).toBe(false)
    expect(restore.hasAttribute("disabled")).toBe(false)
    await user.click(restore)
    view.rerender(<Component compId="xlchemy-card" host={host} />)
    expect(host.cardState).toMatchObject({ format: "JPEG XL", quality: 60, recursive: true })
  })

  test("restores the prototype ingestion port after clearing the table", async () => {
    const host = createHost({ pathsText: "D:/images/a.png" })
    const view = render(<Component compId="xlchemy-card" host={host} />)
    await userEvent.setup().click(screen.getByRole("button", { name: "清空" }))
    view.rerender(<Component compId="xlchemy-card" host={host} />)
    expect(screen.getByText("添加待转换图片")).toBeTruthy()
    expect(screen.getByText("支持拖入文件或文件夹。这里会保留预览、筛选、排序和批量选择，适合先整理再开始转换。")).toBeTruthy()
    expect(screen.getByTestId("xlchemy-input-empty").className).toContain("min-h-[220px]")
    const empty = screen.getByTestId("xlchemy-input-empty")
    expect(within(empty).getByRole("button", { name: "添加文件" }).className).toContain("bg-primary")
    expect(within(empty).getByRole("button", { name: "添加文件夹" }).className).toContain("border")
    expect(empty.querySelector(".lucide-file-image")?.getAttribute("class")).toContain("text-primary")
    expect(within(screen.getByTestId("xlchemy-run-footer")).getByRole("button", { name: "开始转换" }).className).toContain("w-full")
  })

  test("uses native local pickers and keeps selected paths after the host rerenders", async () => {
    const host = createHost({})
    host.localFiles = {
      getUrl: (path) => `local://${path}`,
      pickFiles: async () => ["D:/images/alpha.png", "D:/images/beta.jpg"],
      pickDirectory: async () => "D:/images/folder",
    }
    const view = render(<Component compId="xlchemy-card" host={host} />)
    const user = userEvent.setup()
    await user.click(within(screen.getByTestId("xlchemy-input-empty")).getByRole("button", { name: "添加文件" }))
    await waitFor(() => expect(host.cardState.pathsText).toBe("D:/images/alpha.png\nD:/images/beta.jpg"))
    view.rerender(<Component compId="xlchemy-card" host={host} />)
    expect(screen.getByText("alpha.png")).toBeTruthy()
    expect(screen.getByText("beta.jpg")).toBeTruthy()
    await user.click(screen.getAllByRole("button", { name: "添加文件夹" })[0]!)
    await waitFor(() => expect(host.cardState.pathsText).toContain("D:/images/folder"))
    view.rerender(<Component compId="xlchemy-card" host={host} />)
    expect(host.cardState.selectedPaths).toEqual(["D:/images/alpha.png", "D:/images/beta.jpg", "D:/images/folder"])
  })

  test("selects a real local output directory through the host picker", async () => {
    const host = createHost({ pathsText: "D:/images/a.png", outputMode: "source" })
    host.localFiles!.pickDirectory = async () => "D:/converted"
    const view = render(<Component compId="xlchemy-card" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("radio", { name: "指定目录" }))
    view.rerender(<Component compId="xlchemy-card" host={host} />)
    await user.click(screen.getByRole("button", { name: "选择输出目录" }))

    expect(host.cardState).toMatchObject({ outputMode: "directory", outputDir: "D:/converted" })
  })

  test("configures the real smallest-lossless format pool", async () => {
    const host = createHost({ pathsText: "D:/images/a.png", format: "Smallest Lossless" })
    render(<Component compId="xlchemy-card" host={host} />)
    const user = userEvent.setup()
    const pool = screen.getByRole("group", { name: "最小格式池" })

    await user.click(within(pool).getByRole("button", { name: "WebP" }))
    await user.click(screen.getByRole("button", { name: "预览计划" }))

    expect(host.cardState).toMatchObject({ smallestPng: true, smallestWebp: false, smallestJxl: true })
    expect(host.runCalls[0]?.input).toMatchObject({ format: "Smallest Lossless", smallestFormatPool: { png: true, webp: false, jxl: true } })
  })

  test("keeps the matrix wave smooth and neutral until a real error state", () => {
    const host = createHost({ phase: "idle", progress: 0 })
    const view = render(<Component compId="xlchemy-card" host={host} />)
    const telemetry = screen.getByTestId("xlchemy-telemetry")
    expect(telemetry.getAttribute("data-state")).toBe("standby")
    expect(telemetry.className).toContain("text-muted-foreground")
    expect(telemetry.querySelector(".xlchemy-matrix-wave path[stroke]")?.getAttribute("d")).toContain(" C")
    host.cardState = { ...host.cardState, phase: "error" }
    view.rerender(<Component compId="xlchemy-card" host={host} />)
    expect(screen.getByTestId("xlchemy-telemetry").className).toContain("text-destructive")
  })

  test("preserves the original list, sorting, selection and removal workflow", async () => {
    const host = createHost({ pathsText: "D:/images/z.png\nD:/images/a.png", selectedPaths: [] })
    const view = render(<Component compId="xlchemy-card" host={host} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("radio", { name: "列表视图" }))
    view.rerender(<Component compId="xlchemy-card" host={host} />)
    expect(screen.getByTestId("xlchemy-niko-table")).toBeTruthy()
    const table = screen.getByRole("table")
    expect(within(table).getByText("z.png")).toBeTruthy()
    await user.click(within(table).getByRole("button", { name: "按名称排序" }))
    view.rerender(<Component compId="xlchemy-card" host={host} />)
    const names = within(table).getAllByText(/^[az]\.png$/).map((node) => node.textContent)
    expect(names).toEqual(["z.png", "a.png"])
    await user.click(within(table).getByLabelText("选择 a.png"))
    view.rerender(<Component compId="xlchemy-card" host={host} />)
    await user.click(screen.getByRole("button", { name: "删除已选" }))
    expect(host.cardState.pathsText).toBe("D:/images/z.png")
  })

  test("keeps input formats as toggle tags and sends selected files to the runner", async () => {
    const host = createHost({ pathsText: "D:/images/a.png\nD:/images/b.png", selectedPaths: ["D:/images/b.png"] })
    render(<Component compId="xlchemy-card" host={host} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("tab", { name: "转换" }))
    expect(screen.getByLabelText("禁用 .PNG").getAttribute("data-state")).toBe("on")
    expect(screen.getByLabelText("禁用 .PNG").className).toContain("data-[state=on]:!bg-primary")
    expect(screen.getByLabelText("启用 .AVIF").getAttribute("data-state")).toBe("off")
    expect(screen.getByLabelText("启用 .JXL").getAttribute("data-state")).toBe("off")
    expect(screen.getByLabelText("启用 .WEBP").getAttribute("data-state")).toBe("off")
    expect(screen.getByLabelText("启用 .GIF").getAttribute("data-state")).toBe("off")
    expect(host.cardState.excludedFormatsText).toBe("avif,jxl,webp,gif")
    await user.click(screen.getByLabelText("禁用 .PNG"))
    expect(host.cardState.excludedFormatsText?.split(",")).toContain("png")
    await user.click(screen.getByRole("button", { name: "预览计划" }))
    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.paths).toEqual(["D:/images/b.png"])
  })

  test("combines file settings and uses the width-adaptive shared tabs layout", async () => {
    render(<Component compId="xlchemy-card" host={createHost({ pathsText: "D:/images/a.png" })} />)
    const settingsTabs = screen.getByTestId("xlchemy-settings-tabs")
    const tabList = within(settingsTabs).getByRole("tablist")
    expect(tabList.getAttribute("data-layout")).toBe("fill")
    expect(within(settingsTabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["参数", "转换", "文件", "常规"])
    await userEvent.setup().click(within(settingsTabs).getByRole("tab", { name: "转换" }))
    expect(within(settingsTabs).getAllByText("输入格式")).toHaveLength(2)
    expect(within(settingsTabs).getByText("转换设置")).toBeTruthy()
    expect(within(settingsTabs).getByText("JPEG 编码器")).toBeTruthy()
    expect(within(settingsTabs).getByText("AVIF 编码器")).toBeTruthy()
    expect(within(settingsTabs).getByText("AVIF 位深")).toBeTruthy()
    expect(within(settingsTabs).getByText("禁用渐进式 JPEGli")).toBeTruthy()
    expect(within(settingsTabs).getByText("AOM IQ 调优")).toBeTruthy()
    expect(within(settingsTabs).getByText("保留较大的原图")).toBeTruthy()
    expect(within(settingsTabs).getByText("较大时复制原图")).toBeTruthy()
    expect(within(settingsTabs).getByText("JXL 有损 Modular")).toBeTruthy()
    expect(within(settingsTabs).getByText("自动无损 JPEG")).toBeTruthy()
    await userEvent.setup().click(within(settingsTabs).getByRole("tab", { name: "文件" }))
    expect(within(settingsTabs).getByText("保存")).toBeTruthy()
    expect(within(settingsTabs).getByText("缩小")).toBeTruthy()
    expect(within(settingsTabs).getByText("元数据")).toBeTruthy()
    const operationsTabs = screen.getByTestId("xlchemy-operations-tabs")
    expect(within(operationsTabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["进度", "ExifTool", "高级", "环境"])
  })

  test("keeps the last environment result until diagnosis is requested explicitly", async () => {
    const host = createHost({ pathsText: "D:/images/a.png" })
    const view = render(<Component compId="xlchemy-card" host={host} />)
    await userEvent.setup().click(within(screen.getByTestId("xlchemy-operations-tabs")).getByRole("tab", { name: "环境" }))
    expect(host.runCalls).toHaveLength(0)
    await userEvent.setup().click(screen.getByRole("button", { name: "重新检测" }))
    await waitFor(() => expect(host.runCalls.at(-1)?.input.action).toBe("diagnose"))
    view.rerender(<Component compId="xlchemy-card" host={host} />)
    expect(screen.getByText("slimg CFFI")).toBeTruthy()
    expect(screen.getByText("jpegtran")).toBeTruthy()
    expect(host.cardState.environment).toHaveLength(13)
  })

  test("renders colorful searchable log levels with independent filtering", async () => {
    render(<Component compId="xlchemy-card" host={createHost({ logs: ["12:00:00 converted ok", "12:00:01 warning skip", "12:00:02 error failed"] })} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("tab", { name: "日志" }))
    expect(screen.getByText("converted ok")).toBeTruthy()
    expect(screen.getByText("warning skip")).toBeTruthy()
    expect(screen.getByText("error failed")).toBeTruthy()
    await user.click(screen.getByLabelText("过滤 WRN"))
    expect(screen.queryByText("warning skip")).toBeNull()
    await user.type(screen.getByLabelText("搜索日志"), "converted")
    expect(screen.getByText("converted ok")).toBeTruthy()
    expect(screen.queryByText("error failed")).toBeNull()
    expect(screen.getByText("1 / 3 条")).toBeTruthy()
  })

  test("uses official input and output analysis tabs with real result statistics", async () => {
    const data: XlchemyData = { files: [{ sourcePath: "D:/images/a.png", outputPath: "D:/images/a.jxl", sourceBytes: 1000, outputBytes: 400, status: "converted" }], inputCount: 1, convertedCount: 1, skippedCount: 0, errorCount: 0, inputBytes: 1000, outputBytes: 400, elapsedMs: 2000, errors: [] }
    render(<Component compId="xlchemy-card" host={createHost({ pathsText: "D:/images/a.png", result: data })} />)
    const user = userEvent.setup()
    expect(screen.getByRole("tab", { name: "输入分析" }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByText("格式分布")).toBeTruthy()
    await user.click(screen.getByRole("tab", { name: "输出分析" }))
    expect(screen.getByText("60.0%")).toBeTruthy()
    expect(screen.getByText("大小对比")).toBeTruthy()
    expect(screen.getByText("转换前：1000 B")).toBeTruthy()
    expect(screen.getByText("转换后：400 B")).toBeTruthy()
  })

  test("exposes the original in-place cancel action while conversion is running", async () => {
    const host = createHost({ pathsText: "D:/images/a.png" })
    let finish: ((value: NodeRunResult<XlchemyData>) => void) | undefined
    const pending = new Promise<NodeRunResult<XlchemyData>>((resolve) => { finish = resolve })
    const runner = host.runner!
    runner.run = async function run<TInput, TData>(nodeId: string, input: TInput) {
      host.runCalls.push({ nodeId, input: input as XlchemyInput })
      return await pending as NodeRunResult<TData>
    }
    const cancel = vi.fn(async () => true)
    runner.cancelCurrent = cancel
    render(<Component compId="xlchemy-card" host={host} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "开始转换" }))
    await user.click(await screen.findByRole("button", { name: "取消转换" }))
    expect(cancel).toHaveBeenCalledOnce()
    expect(host.cardState.progressText).toBe("正在停止 Xlchemy 转换…")
    finish?.({ success: false, message: "Cancelled.", data: result })
    await waitFor(() => expect(host.cardState.phase).toBe("cancelled"))
  })
})

type TestPreset = { id: string; name: string; values: Record<string, unknown> }
type TestHost = NodeHostApi<XlchemyCardState, Partial<XlchemyCardState>> & { cardState: XlchemyCardState; presets: TestPreset[]; runCalls: Array<{ nodeId: string; input: XlchemyInput }>; savedConfig?: Partial<XlchemyCardState> }
function createHost(initial: XlchemyCardState): TestHost {
  const host = {
    cardState: { ...initial }, presets: [] as TestPreset[], runCalls: [],
    contract: { name: "xiranite.node-host", version: "1.0.0", supportedCapabilities: ["state", "runner", "clipboard", "config"], hasCapability: () => true },
    env: { theme: "light", platform: "web" },
    state: { getData: () => host.cardState, patchData: (patch: Partial<XlchemyCardState>) => { host.cardState = { ...host.cardState, ...patch } } },
    runner: { run: async <TInput, TData>(nodeId: string, input: TInput, onEvent?: (event: NodeRunEvent) => void): Promise<NodeRunResult<TData>> => { host.runCalls.push({ nodeId, input: input as XlchemyInput }); onEvent?.({ type: "progress", progress: 50, message: "Calibrating." }); return { success: true, message: "Planned.", data: result as TData } } },
    clipboard: { readText: async () => "D:/images/a.png", writeText: async () => undefined },
    localFiles: { getUrl: (path: string) => `local://${path}`, pickFiles: async () => [], pickDirectory: async () => undefined },
    config: {
      get: async () => ({ config: undefined, path: "D:/config/xiranite.config.toml" }),
      save: async (config: Partial<XlchemyCardState>) => { host.savedConfig = config },
      getPresets: async () => ({ presets: host.presets }),
      createPreset: async (input: { name: string; values: Record<string, unknown> }) => {
        const preset = { id: `custom-${host.presets.length + 1}`, ...input }
        host.presets = [...host.presets, preset]
        return { preset }
      },
      updatePreset: async (id: string, input: { name?: string; values?: Record<string, unknown> }) => {
        const preset = host.presets.find((item) => item.id === id)
        if (!preset) throw new Error("Preset not found")
        const next = { ...preset, ...input }
        host.presets = host.presets.map((item) => item.id === id ? next : item)
        return { preset: next }
      },
      deletePreset: async (id: string) => {
        host.presets = host.presets.filter((item) => item.id !== id)
        return { deleted: true }
      },
      openFile: () => undefined,
    },
    getData: <T,>() => host.cardState as T, patchData: (_id: string, patch: Partial<XlchemyCardState>) => host.state.patchData(patch), listComponents: () => [], updateComponent: () => undefined,
  } as unknown as TestHost
  return host
}
function setSurface(mode: NodeSurfaceMode) { Object.assign(surfaceState, NODE_SURFACE_TEST_SPECS[mode]) }
const result: XlchemyData = { files: [], inputCount: 1, convertedCount: 0, skippedCount: 0, errorCount: 0, inputBytes: 0, outputBytes: 0, errors: [] }
