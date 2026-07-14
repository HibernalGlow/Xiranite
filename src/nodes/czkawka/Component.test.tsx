// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { CzkawkaData, CzkawkaInput } from "@xiranite/node-czkawka/core"
import { Component, scanInput } from "./Component"
import type { CzkawkaCardState } from "./types"

const surface = vi.hoisted(() => ({ width: 1200, height: 760, mode: "regular" }))
vi.mock("@/nodes/shared/useNodeSurface", () => ({ useNodeSurface: () => ({ ref: { current: null }, ...surface }) }))
afterEach(cleanup)

describe("Czkawka node", () => {
  test("renders all scanners and sends scan input", async () => {
    const host = createHost({ tool: "duplicate-files", includedDirectoriesText: "D:/media", hashType: "blake3" })
    render(<Component compId="czkawka" host={host} />)
    expect(screen.getByText("Czkawka · 重复文件")).toBeTruthy()
    expect(screen.getByRole("button", { name: "相似图片" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "不正确扩展名" })).toBeTruthy()
    await screen.getByRole("button", { name: "开始扫描" }).click()
    await waitFor(() => expect(host.calls[0]).toEqual(expect.objectContaining({ nodeId: "czkawka", input: expect.objectContaining({ action: "scan", tool: "duplicate-files", includedDirectories: ["D:/media"], hashType: "blake3" }) })))
  })

  test("maps fork-specific media settings into the shared scan contract", () => {
    expect(scanInput("similar-videos", {
      similarity: "7",
      similarVideosIgnoreSameSize: true,
      similarVideosSkipForward: "42",
      similarVideosHashDuration: "18",
      similarVideosCropDetect: "motion",
    })).toMatchObject({
      tool: "similar-videos",
      similarity: 7,
      similarVideosIgnoreSameSize: true,
      similarVideosSkipForward: 42,
      similarVideosHashDuration: 18,
      similarVideosCropDetect: "motion",
    })
  })

  test("keeps results and selections isolated when switching tools", async () => {
    const host = createHost({ tool: "duplicate-files", includedDirectoriesText: "D:/media" }, resultFor)
    const view = render(<Component compId="czkawka" host={host} />)
    await screen.getByRole("button", { name: "开始扫描" }).click()
    await waitFor(() => expect(screen.getAllByText("duplicate-files-result.dat").length).toBeGreaterThan(0))
    await screen.getByRole("checkbox", { name: "选择 duplicate-files-result.dat" }).click()
    expect(screen.getByRole("checkbox", { name: "选择 duplicate-files-result.dat" }).getAttribute("data-state")).toBe("checked")

    await screen.getByRole("button", { name: "空文件" }).click()
    view.rerender(<Component compId="czkawka" host={host} />)
    await screen.getByRole("button", { name: "开始扫描" }).click()
    await waitFor(() => expect(screen.getAllByText("empty-files-result.dat").length).toBeGreaterThan(0))

    await screen.getByRole("button", { name: "重复文件" }).click()
    view.rerender(<Component compId="czkawka" host={host} />)
    expect(screen.getAllByText("duplicate-files-result.dat").length).toBeGreaterThan(0)
    expect(screen.getByRole("checkbox", { name: "选择 duplicate-files-result.dat" }).getAttribute("data-state")).toBe("checked")
  })

  test("links the header search to the result table and isolates it by tool", () => {
    const duplicate = resultFor({ tool: "duplicate-files" })
    const host = createHost({ tool: "duplicate-files", includedDirectoriesText: "D:/media", result: duplicate })
    const view = render(<Component compId="czkawka" host={host} />)
    const headerSearch = screen.getByRole("textbox", { name: "czkawka global filter" })
    fireEvent.change(headerSearch, { target: { value: "not-present" } })
    expect((screen.getByRole("textbox", { name: "filter results" }) as HTMLInputElement).value).toBe("not-present")
    expect(host.stateValue.filterStatesByTool?.["duplicate-files"]?.text.pattern).toBe("not-present")
    expect(screen.getByText("没有匹配当前筛选的结果。")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "空文件" }))
    view.rerender(<Component compId="czkawka" host={host} />)
    expect((screen.getByRole("textbox", { name: "czkawka global filter" }) as HTMLInputElement).value).toBe("")

    fireEvent.click(screen.getByRole("button", { name: "重复文件" }))
    view.rerender(<Component compId="czkawka" host={host} />)
    expect((screen.getByRole("textbox", { name: "czkawka global filter" }) as HTMLInputElement).value).toBe("not-present")
  })

  test("maps a stopped core result to a recoverable stopped GUI state", async () => {
    const host = createHost({ tool: "duplicate-files", includedDirectoriesText: "D:/media" }, () => ({ ...sample, stopped: true }))
    const view = render(<Component compId="czkawka" host={host} />)
    fireEvent.click(screen.getByRole("button", { name: "开始扫描" }))
    await waitFor(() => expect(host.stateValue.phase).toBe("stopped"))
    view.rerender(<Component compId="czkawka" host={host} />)
    expect(screen.getByRole("status").textContent).toContain("Found 1 item(s).")
    expect(screen.getByText("扫描已停止，没有返回结果。")).toBeTruthy()
  })

  test("persists bounded scan and operation activity logs and clears them from the viewer", async () => {
    const host = createHost({ tool: "duplicate-files", includedDirectoriesText: "D:/media", result: resultFor({ tool: "duplicate-files" }) }, resultFor)
    render(<Component compId="czkawka" host={host} />)
    fireEvent.click(screen.getByRole("button", { name: "开始扫描" }))
    await waitFor(() => expect(host.stateValue.activityLog?.map((entry) => entry.kind)).toEqual(["scan", "progress", "scan"]))
    expect(host.stateValue.activityLog?.at(-1)?.level).toBe("success")
    expect(screen.getByText("Scanning")).toBeTruthy()

    fireEvent.click(screen.getByRole("checkbox", { name: "选择 duplicate-files-result.dat" }))
    fireEvent.click(screen.getByRole("button", { name: /删除已选/ }))
    fireEvent.click(screen.getByRole("button", { name: "确认" }))
    await waitFor(() => expect(host.stateValue.activityLog?.some((entry) => entry.action === "delete" && entry.level === "success")).toBe(true))

    fireEvent.click(screen.getByRole("button", { name: "清空活动日志" }))
    expect(host.stateValue.activityLog).toEqual([])
    expect(screen.getByText("没有匹配的日志")).toBeTruthy()
  })

  test("sends shared safe move options and renders detailed per-item results", async () => {
    const operationData: CzkawkaData = { action: "move", tool: "similar-images", groups: [{ id: 0, totalBytes: 0, reclaimableBytes: 0, entries: [{ id: "op:0", groupId: 0, path: "D:/album/a.jpg", name: "a.jpg", size: 0, modifiedDate: 0, secondaryPath: "E:/Review/album/a (1).jpg", operation: "copy", conflictPolicy: "rename", status: "planned" }] }], entries: [{ id: "op:0", groupId: 0, path: "D:/album/a.jpg", name: "a.jpg", size: 0, modifiedDate: 0, secondaryPath: "E:/Review/album/a (1).jpg", operation: "copy", conflictPolicy: "rename", status: "planned" }], messages: "", stopped: false, groupCount: 1, fileCount: 1, totalBytes: 0, reclaimableBytes: 0, affectedCount: 1, errorCount: 0 }
    const initialResult = resultFor({ tool: "similar-images" })
    const host = createHost({ tool: "similar-images", includedDirectoriesText: "D:/album", result: initialResult, destinationDirectory: "E:/Review", copyMode: true, preserveStructure: true, conflictPolicy: "rename", dryRun: true }, (input) => input.action === "move" ? operationData : initialResult)
    const view = render(<Component compId="czkawka" host={host} />)
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 similar-images-result.dat" }))
    fireEvent.click(screen.getByRole("button", { name: "move selected" }))
    await waitFor(() => expect(host.calls.at(-1)?.input).toMatchObject({ action: "move", tool: "similar-images", selectedPaths: ["similar-images-result.dat"], destinationDirectory: "E:/Review", copyMode: true, preserveStructure: true, conflictPolicy: "rename", dryRun: true }))
    view.rerender(<Component compId="czkawka" host={host} />)
    expect(screen.getByText("上次操作详情")).toBeTruthy()
    expect(screen.getByText(/E:\/Review\/album\/a \(1\)\.jpg/)).toBeTruthy()
  })

  test("expands a selected similar-image row into a shared multi-destination group plan", async () => {
    const entries = [{ id: "a", groupId: 7, path: "D:/photos/a.jpg", name: "a.jpg", size: 1, modifiedDate: 1 }, { id: "b", groupId: 7, path: "D:/photos/b.jpg", name: "b.jpg", size: 1, modifiedDate: 1 }]
    const result: CzkawkaData = { ...sample, tool: "similar-images", groups: [{ id: 7, entries, totalBytes: 2, reclaimableBytes: 1 }], entries, groupCount: 1, fileCount: 2, totalBytes: 2, reclaimableBytes: 1 }
    const host = createHost({ tool: "similar-images", result, dryRun: true }, () => ({ ...sample, action: "move", tool: "similar-images" }))
    render(<Component compId="czkawka" host={host} />)
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 a.jpg" }))
    fireEvent.click(screen.getByRole("button", { name: "整理相似组（2）" }))
    fireEvent.click(screen.getByRole("button", { name: "确认整理" }))
    await waitFor(() => expect(host.calls.at(-1)?.input).toMatchObject({ action: "move", selectedPaths: ["D:/photos/a.jpg", "D:/photos/b.jpg"], destinationItems: [{ path: "D:/photos/a.jpg", destination: "D:/photos/variants_0007" }, { path: "D:/photos/b.jpg", destination: "D:/photos/variants_0007" }], dryRun: true }))
  })

  test("persists custom filter presets in node state", () => {
    const host = createHost({ tool: "duplicate-files", includedDirectoriesText: "D:/media", result: resultFor({ tool: "duplicate-files" }) })
    render(<Component compId="czkawka" host={host} />)
    fireEvent.click(screen.getByRole("button", { name: "打开多维筛选" }))
    fireEvent.change(screen.getByRole("textbox", { name: "新预设名称" }), { target: { value: "我的筛选" } })
    fireEvent.click(screen.getByRole("button", { name: /保存/ }))
    expect(host.stateValue.filterPresets).toEqual([expect.objectContaining({ name: "我的筛选" })])
  })

  test("persists the fixed preview switch independently for every tool", () => {
    const host = createHost({ tool: "duplicate-files", includedDirectoriesText: "D:/media", result: resultFor({ tool: "duplicate-files" }) })
    const view = render(<Component compId="czkawka" host={host} />)
    fireEvent.click(screen.getByRole("button", { name: "启用固定预览" }))
    expect(host.stateValue.previewPanelEnabledByTool).toEqual({ "duplicate-files": true })

    fireEvent.click(screen.getByRole("button", { name: "空文件" }))
    view.rerender(<Component compId="czkawka" host={host} />)
    expect(screen.getByRole("button", { name: "启用固定预览" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "启用固定预览" }))
    expect(host.stateValue.previewPanelEnabledByTool).toEqual({ "duplicate-files": true, "empty-files": true })

    fireEvent.click(screen.getByRole("button", { name: "重复文件" }))
    view.rerender(<Component compId="czkawka" host={host} />)
    expect(screen.getByRole("button", { name: "禁用固定预览" })).toBeTruthy()
  })

  test("persists card order, height, collapse, visibility, and cross-panel moves", () => {
    const host = createHost({ tool: "duplicate-files", includedDirectoriesText: "D:/media", result: resultFor({ tool: "duplicate-files" }) })
    render(<Component compId="czkawka" host={host} />)

    fireEvent.click(screen.getByRole("button", { name: "下移统计分析" }))
    expect(host.stateValue.cardLayout?.cards.find((card) => card.id === "analysis")?.order).toBe(2)
    fireEvent.change(screen.getByRole("slider", { name: "调整活动日志高度" }), { target: { value: "416" } })
    expect(host.stateValue.cardLayout?.cards.find((card) => card.id === "logs")?.height).toBe(416)
    fireEvent.click(screen.getByRole("button", { name: "活动日志" }))
    expect(host.stateValue.cardLayout?.cards.find((card) => card.id === "logs")?.collapsed).toBe(true)

    const transfer = { value: "", effectAllowed: "none", setData: vi.fn((_type: string, value: string) => { transfer.value = value }), getData: vi.fn(() => transfer.value) }
    fireEvent.dragStart(document.querySelector('[data-card-id="logs"]')!, { dataTransfer: transfer })
    fireEvent.drop(screen.getByTestId("czkawka-card-stack-source"), { dataTransfer: transfer })
    expect(host.stateValue.cardLayout?.cards.find((card) => card.id === "logs")?.panel).toBe("source")

    fireEvent.click(screen.getByRole("button", { name: "管理卡片" }))
    fireEvent.click(screen.getByRole("button", { name: "隐藏统计分析" }))
    expect(host.stateValue.cardLayout?.cards.find((card) => card.id === "analysis")?.visible).toBe(false)
  })

  test("persists a movable and resizable analysis panel inside the node surface", () => {
    const host = createHost({ tool: "duplicate-files", includedDirectoriesText: "D:/media", result: resultFor({ tool: "duplicate-files" }) })
    render(<Component compId="czkawka" host={host} />)
    fireEvent.click(screen.getByRole("button", { name: "打开浮动分析面板" }))
    expect(host.stateValue.floatingAnalysisPanel?.open).toBe(true)
    const panel = screen.getByTestId("czkawka-floating-analysis")
    const controls = within(panel)
    const moveHandle = controls.getByLabelText("移动浮动分析面板")
    const initialX = host.stateValue.floatingAnalysisPanel!.rect.x
    fireEvent.keyDown(moveHandle, { key: "ArrowLeft" })
    expect(host.stateValue.floatingAnalysisPanel!.rect.x).toBe(initialX - 12)

    const resize = controls.getByRole("separator", { name: "从se方向调整浮动分析面板" })
    fireEvent.pointerDown(resize, { pointerId: 9, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(resize, { pointerId: 9, clientX: 5000, clientY: 5000 })
    fireEvent.pointerUp(resize, { pointerId: 9 })
    const rect = host.stateValue.floatingAnalysisPanel!.rect
    expect(rect.x + rect.width).toBeLessThanOrEqual(1192)
    expect(rect.y + rect.height).toBeLessThanOrEqual(752)

    fireEvent.click(controls.getByRole("button", { name: "关闭浮动分析面板" }))
    expect(host.stateValue.floatingAnalysisPanel?.open).toBe(false)
    expect(screen.queryByTestId("czkawka-floating-analysis")).toBeNull()
  })

  test("keeps per-tool selection history synchronized with the result table", async () => {
    const host = createHost({ tool: "duplicate-files", includedDirectoriesText: "D:/media", result: resultFor({ tool: "duplicate-files" }) })
    render(<Component compId="czkawka" host={host} />)
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 duplicate-files-result.dat" }))
    expect(screen.getByRole("checkbox", { name: "选择 duplicate-files-result.dat" }).getAttribute("data-state")).toBe("checked")
    fireEvent.click(screen.getByRole("button", { name: /选择助手/ }))
    fireEvent.click(await screen.findByRole("button", { name: /清空选择/ }))
    expect(screen.getByRole("checkbox", { name: "选择 duplicate-files-result.dat" }).getAttribute("data-state")).toBe("unchecked")
    fireEvent.click(screen.getByRole("button", { name: "撤销选择" }))
    expect(screen.getByRole("checkbox", { name: "选择 duplicate-files-result.dat" }).getAttribute("data-state")).toBe("checked")
  })

  test("persists selection assistant visibility and rule configuration", () => {
    const host = createHost({ tool: "duplicate-files", includedDirectoriesText: "D:/media", result: resultFor({ tool: "duplicate-files" }) })
    render(<Component compId="czkawka" host={host} />)
    fireEvent.click(screen.getByRole("button", { name: /选择助手/ }))
    expect(host.stateValue.selectionAssistantOpen).toBe(true)
    const textTab = screen.getByRole("tab", { name: "文本规则" })
    fireEvent.pointerDown(textTab, { button: 0 })
    fireEvent.mouseDown(textTab, { button: 0 })
    fireEvent.click(textTab)
    fireEvent.change(screen.getByRole("textbox", { name: "文本规则模式" }), { target: { value: "archive" } })
    expect(host.stateValue.selectionAssistantConfig?.text.pattern).toBe("archive")
  })
})

type TestHost = NodeHostApi<CzkawkaCardState, Partial<CzkawkaCardState>> & { stateValue: CzkawkaCardState; calls: Array<{ nodeId: string; input: CzkawkaInput }> }
function createHost(initial: CzkawkaCardState, resultFactory: (input: CzkawkaInput) => CzkawkaData = () => sample): TestHost {
  const host: TestHost = {
    stateValue: initial,
    calls: [],
    contract: { name: "xiranite.node-host", version: "1.0.0", supportedCapabilities: ["contract", "state", "runner"], hasCapability: () => true },
    env: { theme: "light", platform: "web" },
    state: { getData: () => host.stateValue, patchData: (patch) => { host.stateValue = { ...host.stateValue, ...patch } } },
    runner: { run: async <TInput, TData>(nodeId: string, input: TInput, onEvent?: (event: NodeRunEvent) => void): Promise<NodeRunResult<TData>> => { host.calls.push({ nodeId, input: input as CzkawkaInput }); onEvent?.({ type: "progress", progress: 50, message: "Scanning" }); return { success: true, message: "Found 1 item(s).", data: resultFactory(input as CzkawkaInput) as TData } } },
    getData: <T,>() => host.stateValue as T,
    patchData: (_id, patch) => { host.stateValue = { ...host.stateValue, ...patch } },
    listComponents: () => [],
    updateComponent: () => undefined,
  }
  return host
}

const sample: CzkawkaData = { action: "scan", tool: "duplicate-files", groups: [], entries: [], messages: "", stopped: false, groupCount: 0, fileCount: 0, totalBytes: 0, reclaimableBytes: 0, affectedCount: 0, errorCount: 0 }

function resultFor(input: CzkawkaInput): CzkawkaData {
  const tool = input.tool ?? "duplicate-files"
  const path = `${tool}-result.dat`
  const entry = { id: path, groupId: 0, path, name: path, size: 10, modifiedDate: 1 }
  const group = { id: 0, entries: [entry], totalBytes: 10, reclaimableBytes: 0 }
  return { action: "scan", tool, groups: [group], entries: [entry], messages: "", stopped: false, groupCount: 1, fileCount: 1, totalBytes: 10, reclaimableBytes: 0, affectedCount: 0, errorCount: 0 }
}
