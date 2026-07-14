// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { CzkawkaData, CzkawkaInput } from "@xiranite/node-czkawka/core"
import { Component, scanInput } from "./Component"
import type { CzkawkaCardState } from "./types"
import i18n from "@/i18n"

const surface = vi.hoisted(() => ({ width: 1200, height: 760, mode: "regular" }))
const NODE_SURFACE_TEST_MODES = [
  ["collapsed", 280, 64, "czkawka-collapsed-view"],
  ["compact", 640, 480, "czkawka-compact-view"],
  ["portrait", 420, 720, "czkawka-compact-view"],
  ["regular", 1200, 760, "czkawka-full-view"],
  ["expanded", 1600, 900, "czkawka-full-view"],
  ["workspace", 1440, 860, "czkawka-full-view"],
] as const
vi.mock("@/nodes/shared/useNodeSurface", () => ({ useNodeSurface: () => ({ ref: { current: null }, ...surface }) }))
afterEach(async () => { cleanup(); Object.assign(surface, { width: 1200, height: 760, mode: "regular" }); await i18n.changeLanguage("zh") })

describe("Czkawka node", () => {
  test.each([
    ["regular", 1200, 760, "czkawka-full-view"],
    ["compact", 640, 480, "czkawka-compact-view"],
  ] as const)("keeps all eleven scanners reachable in the %s tool rail", (mode, width, height, testId) => {
    Object.assign(surface, { mode, width, height })
    render(<Component compId="czkawka-tools" host={createHost({ tool: "duplicate-files" })} />)
    expect(screen.getByTestId(testId)).toBeTruthy()
    for (const label of ["重复文件", "空文件夹", "大文件", "空文件", "临时文件", "相似图片", "相似视频", "重复音频", "无效符号链接", "损坏文件", "不正确扩展名"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy()
    }
  })

  test("inherits host theme and background while leaving window controls to the desktop shell", () => {
    const host = createHost({ tool: "duplicate-files" })
    host.env.theme = "dark"
    render(<Component compId="czkawka-host-mapping" host={host} />)
    const root = screen.getByTestId("czkawka-surface")
    expect(root.dataset.hostTheme).toBe("dark")
    expect(root.classList.contains("bg-transparent")).toBe(true)
    expect(root.classList.contains("bg-background")).toBe(false)
    expect(root.classList.contains("text-foreground")).toBe(true)
    expect(screen.queryByRole("button", { name: /(?:minimize|maximize|close|最小化窗口|最大化窗口|关闭窗口)/i })).toBeNull()
  })

  test("reacts to the Xiranite language and renders the shared English scanner copy", async () => {
    await i18n.changeLanguage("en")
    render(<Component compId="czkawka-en" host={createHost({ tool: "duplicate-files" })} />)
    expect(screen.getByRole("button", { name: "Duplicate Files" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Start scan" })).toBeTruthy()
    expect(screen.getByText("Scan conditions")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "开始扫描" })).toBeNull()
  })

  test.each(NODE_SURFACE_TEST_MODES)("renders the %s surface without losing the primary action", (mode, width, height, testId) => {
    Object.assign(surface, { mode, width, height })
    const host = createHost({ tool: "duplicate-files", includedDirectoriesText: "D:/media" })
    render(<Component compId="czkawka" host={host} />)
    expect(screen.getByTestId(testId)).toBeTruthy()
    expect(screen.getByRole("button", { name: "开始扫描" })).toBeTruthy()
  })

  test("renders all scanners and sends scan input", async () => {
    const host = createHost({ tool: "duplicate-files", includedDirectoriesText: "D:/media", hashType: "blake3", threadCount: "6" })
    render(<Component compId="czkawka" host={host} />)
    expect(screen.getByText("Czkawka · 重复文件")).toBeTruthy()
    expect(screen.getByRole("button", { name: "相似图片" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "不正确扩展名" })).toBeTruthy()
    await screen.getByRole("button", { name: "开始扫描" }).click()
    await waitFor(() => expect(host.calls[0]).toEqual(expect.objectContaining({ nodeId: "czkawka", input: expect.objectContaining({ action: "scan", tool: "duplicate-files", includedDirectories: ["D:/media"], hashType: "blake3", threadCount: 6 }) })))
  })

  test("switches the running action to native cancellation", async () => {
    const host = createHost({ tool: "duplicate-files", includedDirectoriesText: "D:/media" })
    let finish!: (result: NodeRunResult<CzkawkaData>) => void
    host.runner!.run = async <TInput, TData>(nodeId: string, input: TInput) => {
      host.calls.push({ nodeId, input: input as CzkawkaInput })
      return await new Promise<NodeRunResult<CzkawkaData>>((resolve) => { finish = resolve }) as NodeRunResult<TData>
    }
    render(<Component compId="czkawka" host={host} />)
    fireEvent.click(screen.getByRole("button", { name: "开始扫描" }))
    const stop = await screen.findByRole("button", { name: "停止扫描" })
    fireEvent.click(stop)
    await waitFor(() => expect(host.cancelCalls).toBe(1))
    expect(host.stateValue.progressText).toContain("正在请求停止")
    finish({ success: false, message: "Stopped duplicate-files.", data: { ...sample, stopped: true } })
    await waitFor(() => expect(host.stateValue.phase).toBe("stopped"))
  })

  test("manages fork-compatible source lists, references, rules, and extension tokens", async () => {
    const host = createHost({
      tool: "duplicate-files",
      includedDirectoriesText: "D:/one\nD:/two",
      includedDirectoriesReferencedText: "D:/two",
      excludedDirectoriesText: "E:/skip",
      excludedItemsText: "*/cache/*",
      allowedExtensions: ".jpg;png",
      excludedExtensions: "tmp,bak",
    })
    host.pickedDirectory = "F:/picked"
    const view = render(<Component compId="czkawka" host={host} />)

    fireEvent.change(screen.getByRole("textbox", { name: "批量粘贴包含目录" }), { target: { value: '\u2068"G:/quoted"\u2069;D:/one,H:/comma' } })
    fireEvent.click(screen.getByRole("button", { name: "添加粘贴的包含目录" }))
    expect(host.stateValue.includedDirectoriesText).toBe("G:/quoted\nD:/one\nH:/comma\nD:/two")

    view.rerender(<Component compId="czkawka" host={host} />)
    fireEvent.click(screen.getByRole("button", { name: "浏览添加包含目录" }))
    await waitFor(() => expect(host.stateValue.includedDirectoriesText?.startsWith("F:/picked\n")).toBe(true))

    view.rerender(<Component compId="czkawka" host={host} />)
    fireEvent.click(screen.getByRole("button", { name: "全部设为参考目录" }))
    expect(host.stateValue.includedDirectoriesReferencedText).toBe(host.stateValue.includedDirectoriesText)
    view.rerender(<Component compId="czkawka" host={host} />)
    fireEvent.click(screen.getByRole("button", { name: "移除目录 D:/two" }))
    expect(host.stateValue.includedDirectoriesReferencedText).not.toContain("D:/two")

    view.rerender(<Component compId="czkawka" host={host} />)
    fireEvent.click(screen.getByRole("checkbox", { name: "选择目录 E:/skip" }))
    fireEvent.click(screen.getByRole("button", { name: "移除选中的排除目录" }))
    expect(host.stateValue.excludedDirectoriesText).toBe("")
    fireEvent.click(screen.getByRole("button", { name: "移除 jpg" }))
    expect(host.stateValue.allowedExtensions).toBe("png")
    fireEvent.change(screen.getByRole("textbox", { name: "排除项目输入" }), { target: { value: "*/cache/*,*.part;DEFAULT" } })
    expect(host.stateValue.excludedItemsText).toBe("*/cache/*,*.part;DEFAULT")
    fireEvent.click(screen.getByRole("button", { name: "重置排除扩展名" }))
    expect(host.stateValue.excludedExtensions).toBe("")

    expect(scanInput("duplicate-files", host.stateValue)).toMatchObject({
      includedDirectories: ["F:/picked", "G:/quoted", "D:/one", "H:/comma"],
      includedDirectoriesReferenced: ["F:/picked", "G:/quoted", "D:/one", "H:/comma"],
      excludedDirectories: [],
      excludedItems: ["*/cache/*", "*.part", "DEFAULT"],
      allowedExtensions: "png",
      excludedExtensions: undefined,
    })
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
    const headerSearch = screen.getByRole("textbox", { name: "Czkawka 全局筛选" })
    fireEvent.change(headerSearch, { target: { value: "not-present" } })
    expect((screen.getByRole("textbox", { name: "filter results" }) as HTMLInputElement).value).toBe("not-present")
    expect(host.stateValue.filterStatesByTool?.["duplicate-files"]?.text.pattern).toBe("not-present")
    expect(screen.getByText("没有匹配当前筛选的结果。")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "空文件" }))
    view.rerender(<Component compId="czkawka" host={host} />)
    expect((screen.getByRole("textbox", { name: "Czkawka 全局筛选" }) as HTMLInputElement).value).toBe("")

    fireEvent.click(screen.getByRole("button", { name: "重复文件" }))
    view.rerender(<Component compId="czkawka" host={host} />)
    expect((screen.getByRole("textbox", { name: "Czkawka 全局筛选" }) as HTMLInputElement).value).toBe("not-present")
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
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }))
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
    fireEvent.click(screen.getByRole("button", { name: "确认移动" }))
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

  test("exports all full result rows independently from the current selection", async () => {
    const entries = [{ id: "a", groupId: 0, path: "D:/a.jpg", name: "a.jpg", size: 10, modifiedDate: 1, width: 100, height: 80 }, { id: "b", groupId: 0, path: "D:/b.jpg", name: "b.jpg", size: 11, modifiedDate: 2, similarity: "3" }]
    const result: CzkawkaData = { ...sample, tool: "similar-images", groups: [{ id: 0, entries, totalBytes: 21, reclaimableBytes: 10 }], entries, groupCount: 1, fileCount: 2, totalBytes: 21, reclaimableBytes: 10 }
    const host = createHost({ tool: "similar-images", result, exportScope: "all", outputPath: "D:/result.json" })
    render(<Component compId="czkawka" host={host} />)
    fireEvent.click(screen.getByRole("button", { name: "save selected" }))
    await waitFor(() => expect(host.calls.at(-1)?.input).toMatchObject({ action: "save", exportScope: "all", selectedPaths: ["D:/a.jpg", "D:/b.jpg"], exportEntries: entries, outputPath: "D:/result.json", dryRun: false }))
  })

  test("builds a selected bad-extension rename plan with an undo hint", async () => {
    const entry = { id: "bad", groupId: 0, path: "D:/photo.bin", name: "photo.bin", size: 10, modifiedDate: 1, properExtension: "jpg" }
    const result: CzkawkaData = { ...sample, tool: "bad-extensions", groups: [{ id: 0, entries: [entry], totalBytes: 10, reclaimableBytes: 0 }], entries: [entry], groupCount: 1, fileCount: 1, totalBytes: 10 }
    const host = createHost({ tool: "bad-extensions", result, dryRun: true })
    render(<Component compId="czkawka" host={host} />)
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 photo.bin" }))
    fireEvent.click(screen.getByRole("button", { name: "修正扩展名（1）" }))
    expect(screen.getByText(/反向改名/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "确认改名" }))
    await waitFor(() => expect(host.calls.at(-1)?.input).toMatchObject({ action: "rename", selectedPaths: ["D:/photo.bin"], renameItems: [{ path: "D:/photo.bin", properExtension: "jpg" }], dryRun: true }))
  })

  test("creates, overwrites, exports, deletes, and reimports persistent scan presets", () => {
    const host = createHost({ tool: "similar-images", includedDirectoriesText: "D:/photos", similarity: "7" })
    const view = render(<Component compId="czkawka" host={host} />)
    fireEvent.click(screen.getByText(/扫描配置预设/))
    fireEvent.change(screen.getByRole("textbox", { name: "scan preset name" }), { target: { value: "照片库" } })
    fireEvent.click(screen.getByRole("button", { name: "新建" }))
    expect(host.stateValue.scanPresets).toEqual([expect.objectContaining({ name: "照片库", tool: "similar-images", input: expect.objectContaining({ includedDirectories: ["D:/photos"], similarity: 7 }) })])
    expect(host.stateValue.activeScanPresetId).toBe(host.stateValue.scanPresets?.[0]?.id)

    view.rerender(<Component compId="czkawka" host={host} />)
    fireEvent.change(screen.getByRole("textbox", { name: "scan preset name" }), { target: { value: "照片库 HQ" } })
    fireEvent.click(screen.getByRole("button", { name: "覆盖" }))
    expect(host.stateValue.scanPresets).toHaveLength(1)
    expect(host.stateValue.scanPresets?.[0]?.name).toBe("照片库 HQ")

    view.rerender(<Component compId="czkawka" host={host} />)
    fireEvent.click(screen.getByRole("button", { name: "导出" }))
    const transfer = screen.getByRole("textbox", { name: "scan preset transfer" }) as HTMLTextAreaElement
    expect(transfer.value).toContain("xiranite.czkawka.scan-presets")
    fireEvent.click(screen.getByRole("button", { name: "删除" }))
    expect(host.stateValue.scanPresets).toEqual([])

    view.rerender(<Component compId="czkawka" host={host} />)
    fireEvent.click(screen.getByRole("button", { name: "导入合并" }))
    expect(host.stateValue.scanPresets?.[0]?.name).toBe("照片库 HQ")
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

  test("switches and persists the similar-image folder result view", () => {
    const entry = { id: "image", groupId: 0, path: "D:/photos/a.jpg", name: "a.jpg", size: 12, modifiedDate: 1, width: 100, height: 80, similarity: "2" }
    const result: CzkawkaData = { ...sample, tool: "similar-images", groups: [{ id: 0, entries: [entry], totalBytes: 12, reclaimableBytes: 0 }], entries: [entry], groupCount: 1, fileCount: 1, totalBytes: 12, similarFolders: [{ path: "D:/photos", count: 3, bytes: 42, groupCount: 2, previewPath: entry.path }] }
    const host = createHost({ tool: "similar-images", result })
    render(<Component compId="czkawka" host={host} />)
    const foldersTab = screen.getByRole("tab", { name: /文件夹/ })
    fireEvent.pointerDown(foldersTab, { button: 0 })
    fireEvent.mouseDown(foldersTab, { button: 0 })
    fireEvent.click(foldersTab)
    expect(host.stateValue.similarImagesViewMode).toBe("folders")
    expect(screen.getByTestId("czkawka-similar-folders")).toBeTruthy()
    expect(screen.getByText("D:/photos")).toBeTruthy()
    const imagesTab = screen.getByRole("tab", { name: "图片" })
    fireEvent.pointerDown(imagesTab, { button: 0 })
    fireEvent.mouseDown(imagesTab, { button: 0 })
    fireEvent.click(imagesTab)
    expect(host.stateValue.similarImagesViewMode).toBe("images")
    expect(screen.getByTestId("czkawka-result-table")).toBeTruthy()
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

  test("persists, minimizes, and resets the desktop workspace layout", () => {
    Object.assign(surface, { mode: "workspace", width: 1440, height: 860 })
    const host = createHost({ tool: "duplicate-files", includedDirectoriesText: "D:/media" })
    const view = render(<Component compId="czkawka" host={host} />)

    const sourceResize = screen.getByRole("separator", { name: "调整扫描条件宽度" })
    fireEvent.keyDown(sourceResize, { key: "ArrowRight", shiftKey: true })
    expect(host.stateValue.workspaceLayout?.sourcePanelWidth).toBe(332)
    fireEvent.doubleClick(sourceResize)
    expect(host.stateValue.workspaceLayout?.sourcePanelWidth).toBe(300)

    fireEvent.click(screen.getByRole("button", { name: "最小化扫描条件" }))
    expect(host.stateValue.workspaceLayout?.sourcePanelMinimized).toBe(true)
    view.rerender(<Component compId="czkawka" host={host} />)
    fireEvent.click(screen.getByRole("button", { name: "恢复扫描条件" }))
    expect(host.stateValue.workspaceLayout?.sourcePanelMinimized).toBe(false)

    fireEvent.click(screen.getByRole("button", { name: "最小化分析与操作" }))
    expect(host.stateValue.workspaceLayout?.analysisPanelMinimized).toBe(true)
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

type TestHost = NodeHostApi<CzkawkaCardState, Partial<CzkawkaCardState>> & { stateValue: CzkawkaCardState; calls: Array<{ nodeId: string; input: CzkawkaInput }>; cancelCalls: number; pickedDirectory?: string }
function createHost(initial: CzkawkaCardState, resultFactory: (input: CzkawkaInput) => CzkawkaData = () => sample): TestHost {
  const host: TestHost = {
    stateValue: initial,
    calls: [],
    cancelCalls: 0,
    contract: { name: "xiranite.node-host", version: "1.0.0", supportedCapabilities: ["contract", "state", "runner"], hasCapability: () => true },
    env: { theme: "light", platform: "web" },
    localFiles: { getUrl: (path) => `local://${path}`, pickDirectory: async () => host.pickedDirectory },
    state: { getData: () => host.stateValue, patchData: (patch) => { host.stateValue = { ...host.stateValue, ...patch } } },
    runner: { run: async <TInput, TData>(nodeId: string, input: TInput, onEvent?: (event: NodeRunEvent) => void): Promise<NodeRunResult<TData>> => { host.calls.push({ nodeId, input: input as CzkawkaInput }); onEvent?.({ type: "progress", progress: 50, message: "Scanning" }); return { success: true, message: "Found 1 item(s).", data: resultFactory(input as CzkawkaInput) as TData } }, cancelCurrent: async () => { host.cancelCalls += 1; return true } },
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
