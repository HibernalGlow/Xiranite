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

  test("switches the shared config preset, persists it to TOML config, and sends a plan", async () => {
    const host = createHost({ pathsText: "D:/images/a.png" })
    render(<Component compId="xlchemy-card" host={host} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "配置管理" }))
    await user.click(screen.getByRole("combobox", { name: "预设" }))
    await user.click(screen.getByRole("option", { name: "Gamma" }))
    expect(host.cardState).toMatchObject({ selectedPreset: "gamma", format: "WebP", lossless: false, quality: 82, effort: 6 })
    await user.click(screen.getByRole("button", { name: "保存为默认" }))
    await waitFor(() => expect(host.savedConfig).toMatchObject({ selectedPreset: "gamma", format: "WebP", lossless: false, quality: 82, effort: 6 }))
    await user.click(screen.getByRole("button", { name: "预览计划" }))
    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toMatchObject({ nodeId: "xlchemy", input: { action: "plan", paths: ["D:/images/a.png"], format: "WebP", lossless: false } })
  })

  test("restores the prototype ingestion port after clearing the table", async () => {
    const host = createHost({ pathsText: "D:/images/a.png" })
    const view = render(<Component compId="xlchemy-card" host={host} />)
    await userEvent.setup().click(screen.getByRole("button", { name: "清空" }))
    view.rerender(<Component compId="xlchemy-card" host={host} />)
    expect(screen.getByText("添加待转换图片")).toBeTruthy()
    expect(screen.getByText("支持拖入文件或文件夹。这里会保留预览、筛选、排序和批量选择，适合先整理再开始转换。")).toBeTruthy()
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
    await user.click(screen.getByRole("tab", { name: "文件" }))
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
    await userEvent.setup().click(within(settingsTabs).getByRole("tab", { name: "文件" }))
    expect(within(settingsTabs).getByText("保存")).toBeTruthy()
    expect(within(settingsTabs).getByText("输入")).toBeTruthy()
    expect(within(settingsTabs).getByText("缩小")).toBeTruthy()
    expect(within(settingsTabs).getByText("元数据")).toBeTruthy()
    const operationsTabs = screen.getByTestId("xlchemy-operations-tabs")
    expect(within(operationsTabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["进度", "ExifTool", "高级", "环境"])
  })

  test("opens environment maintenance with the complete tool inventory and starts diagnosis", async () => {
    const host = createHost({ pathsText: "D:/images/a.png" })
    const view = render(<Component compId="xlchemy-card" host={host} />)
    await userEvent.setup().click(within(screen.getByTestId("xlchemy-operations-tabs")).getByRole("tab", { name: "环境" }))
    await waitFor(() => expect(host.runCalls.at(-1)?.input.action).toBe("diagnose"))
    view.rerender(<Component compId="xlchemy-card" host={host} />)
    expect(screen.getByText("slimg CFFI")).toBeTruthy()
    expect(screen.getByText("jpegtran")).toBeTruthy()
    expect(host.cardState.environment).toHaveLength(12)
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

type TestHost = NodeHostApi<XlchemyCardState, Partial<XlchemyCardState>> & { cardState: XlchemyCardState; runCalls: Array<{ nodeId: string; input: XlchemyInput }>; savedConfig?: Partial<XlchemyCardState> }
function createHost(initial: XlchemyCardState): TestHost {
  const host = {
    cardState: { ...initial }, runCalls: [],
    contract: { name: "xiranite.node-host", version: "1.0.0", supportedCapabilities: ["state", "runner", "clipboard", "config"], hasCapability: () => true },
    env: { theme: "light", platform: "web" },
    state: { getData: () => host.cardState, patchData: (patch: Partial<XlchemyCardState>) => { host.cardState = { ...host.cardState, ...patch } } },
    runner: { run: async <TInput, TData>(nodeId: string, input: TInput, onEvent?: (event: NodeRunEvent) => void): Promise<NodeRunResult<TData>> => { host.runCalls.push({ nodeId, input: input as XlchemyInput }); onEvent?.({ type: "progress", progress: 50, message: "Calibrating." }); return { success: true, message: "Planned.", data: result as TData } } },
    clipboard: { readText: async () => "D:/images/a.png", writeText: async () => undefined },
    config: { get: async () => ({ config: undefined, path: "D:/config/xiranite.config.toml" }), save: async (config: Partial<XlchemyCardState>) => { host.savedConfig = config }, openFile: () => undefined },
    getData: <T,>() => host.cardState as T, patchData: (_id: string, patch: Partial<XlchemyCardState>) => host.state.patchData(patch), listComponents: () => [], updateComponent: () => undefined,
  } as unknown as TestHost
  return host
}
function setSurface(mode: NodeSurfaceMode) { Object.assign(surfaceState, NODE_SURFACE_TEST_SPECS[mode]) }
const result: XlchemyData = { files: [], inputCount: 1, convertedCount: 0, skippedCount: 0, errorCount: 0, inputBytes: 0, outputBytes: 0, errors: [] }
