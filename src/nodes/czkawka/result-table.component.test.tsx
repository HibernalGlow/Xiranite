// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { cleanup } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import type { CzkawkaEntry, CzkawkaGroup } from "@xiranite/node-czkawka/core"
import { CzkawkaResultTable } from "./result-table"
import i18n from "@/i18n"

afterEach(async () => { cleanup(); await i18n.changeLanguage("zh") })

describe("CzkawkaResultTable", () => {
  test("switches columns, states, and row actions with the Xiranite language", async () => {
    await i18n.changeLanguage("en")
    const { container } = render(<CzkawkaResultTable tool="duplicate-music" groups={[group]} running={false} selectedPaths={[]} onSelectionChange={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Title" })).toBeTruthy()
    expect(screen.getByRole("textbox", { name: "Filter results" })).toBeTruthy()
    fireEvent.contextMenu(container.querySelector('[data-index="a.mp3"]') as HTMLElement)
    expect(await screen.findByText("Copy file")).toBeTruthy()
  })

  test("renders media-specific columns and keeps filters isolated by tool", () => {
    const props = { groups: [group], running: false, selectedPaths: [], onSelectionChange: vi.fn() }
    const view = render(<CzkawkaResultTable tool="duplicate-music" {...props} />)
    expect(screen.getByRole("button", { name: /标题/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /艺术家/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /码率/ })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /标题/ }))
    fireEvent.click(screen.getByRole("button", { name: /标题/ }))
    expect(screen.getByRole("button", { name: /标题/ }).querySelector(".lucide-arrow-down")).toBeTruthy()
    fireEvent.change(screen.getByRole("textbox", { name: "筛选结果" }), { target: { value: "needle" } })

    view.rerender(<CzkawkaResultTable tool="similar-images" {...props} />)
    expect((screen.getByRole("textbox", { name: "筛选结果" }) as HTMLInputElement).value).toBe("")
    expect(screen.getByRole("button", { name: /相似度/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /分辨率/ })).toBeTruthy()

    view.rerender(<CzkawkaResultTable tool="duplicate-music" {...props} />)
    expect((screen.getByRole("textbox", { name: "筛选结果" }) as HTMLInputElement).value).toBe("needle")
    expect(screen.getByRole("button", { name: /标题/ }).querySelector(".lucide-arrow-down")).toBeTruthy()
  })

  test("passes desktop selection modifiers to the shared selection model", () => {
    const onSelectionChange = vi.fn()
    render(<CzkawkaResultTable tool="empty-files" groups={[group]} running={false} selectedPaths={["a.mp3"]} onSelectionChange={onSelectionChange} />)
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 b.mp3" }), { ctrlKey: true })
    expect(onSelectionChange).toHaveBeenLastCalledWith(["a.mp3", "b.mp3"])
  })

  test("virtualizes ten thousand rows, limits DOM rows, and updates the window while scrolling", async () => {
    const manyEntries = Array.from({ length: 10_000 }, (_, index) => entry(`file-${index}.mp3`, `Track ${index}`))
    const manyGroup = { ...group, entries: manyEntries }
    const { container } = render(<CzkawkaResultTable tool="empty-files" groups={[manyGroup]} running={false} selectedPaths={[]} onSelectionChange={vi.fn()} />)
    const renderedRows = container.querySelectorAll('[data-slot="table-body"] tr[data-index]')
    expect(renderedRows.length).toBeGreaterThan(0)
    expect(renderedRows.length).toBeLessThan(80)
    expect((container.querySelector('[data-slot="table-body"]') as HTMLElement).style.height).toBe("520000px")
    const viewport = screen.getByTestId("czkawka-result-viewport")
    viewport.scrollTop = 4_236
    fireEvent.scroll(viewport)
    await waitFor(() => expect(container.textContent).toContain("file-73.mp3"))
    expect(container.querySelectorAll('[data-slot="table-body"] tr[data-index]').length).toBeLessThan(80)
  })

  test("resizes columns without changing the fixed preview row height", () => {
    const view = render(<CzkawkaResultTable tool="empty-files" groups={[group]} running={false} selectedPaths={[]} onSelectionChange={vi.fn()} />)
    const handle = screen.getByRole("separator", { name: "调整名称列宽" })
    expect((handle.parentElement as HTMLElement).style.width).toBe("160px")
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 180 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 180 })
    expect((handle.parentElement as HTMLElement).style.width).toBe("240px")
    expect((view.container.querySelector('[data-slot="table-body"] tr[data-index]') as HTMLElement).style.height).toBe("52px")
  })

  test("wraps table text at a fixed virtual height and only reverses the displayed path", () => {
    const path = "C:\\photos\\2026\\cover.jpg"
    const wrappedGroup: CzkawkaGroup = { id: 0, entries: [{ id: path, groupId: 0, path, name: "cover.jpg", size: 10, modifiedDate: 1 }], totalBytes: 10, reclaimableBytes: 0 }
    const onCopyText = vi.fn().mockResolvedValue(undefined)
    const { container } = render(<CzkawkaResultTable tool="empty-files" groups={[wrappedGroup]} running={false} reversePathDisplay wrapText selectedPaths={[]} onCopyText={onCopyText} onSelectionChange={vi.fn()} />)
    expect(screen.getByText("cover.jpg ‹ 2026 ‹ photos ‹ C:")).toBeTruthy()
    const row = container.querySelector("[data-index]") as HTMLElement
    expect(row.style.height).toBe("72px")
    fireEvent.contextMenu(row)
    fireEvent.click(screen.getByText("复制路径"))
    expect(onCopyText).toHaveBeenCalledWith(path)
  })

  test("resizes preview thumbnails and virtual row height per tool", () => {
    const props = { groups: [group], running: false, selectedPaths: [], onSelectionChange: vi.fn() }
    const view = render(<CzkawkaResultTable tool="empty-files" {...props} />)
    const handle = screen.getByRole("separator", { name: "调整预览列宽" })
    fireEvent.pointerDown(handle, { pointerId: 2, clientX: 100 })
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 180 })
    fireEvent.pointerUp(handle, { pointerId: 2, clientX: 180 })
    expect((view.container.querySelector('[data-slot="table-body"] tr[data-index]') as HTMLElement).style.height).toBe("132px")
    expect((view.container.querySelector('[data-slot="table-body"]') as HTMLElement).style.height).toBe("264px")

    view.rerender(<CzkawkaResultTable tool="similar-images" {...props} />)
    expect((view.container.querySelector('[data-slot="table-body"] tr[data-index]') as HTMLElement).style.height).toBe("52px")
    view.rerender(<CzkawkaResultTable tool="empty-files" {...props} />)
    expect((view.container.querySelector('[data-slot="table-body"] tr[data-index]') as HTMLElement).style.height).toBe("132px")
  })

  test("removes the thumbnail column without affecting result rows", () => {
    const { container } = render(<CzkawkaResultTable tool="similar-images" groups={[group]} running={false} thumbnailEnabled={false} selectedPaths={[]} onSelectionChange={vi.fn()} />)
    expect(screen.queryByRole("separator", { name: "调整预览列宽" })).toBeNull()
    expect(container.querySelectorAll('[data-slot="table-body"] img')).toHaveLength(0)
    expect((container.querySelector('[data-slot="table-body"] tr[data-index]') as HTMLElement).style.height).toBe("52px")
  })

  test("resolves media URLs only for the bounded virtual window", () => {
    const getFileUrl = vi.fn((path: string) => `http://local/${path}`)
    const manyEntries = Array.from({ length: 10_000 }, (_, index) => entry(`image-${String(index).padStart(5, "0")}.jpg`, `Image ${index}`))
    const { container } = render(<CzkawkaResultTable tool="empty-files" groups={[{ ...group, entries: manyEntries }]} running={false} selectedPaths={[]} getFileUrl={getFileUrl} onSelectionChange={vi.fn()} />)
    expect(container.querySelectorAll("img").length).toBeGreaterThan(0)
    expect(container.querySelectorAll("img").length).toBeLessThan(80)
    expect(getFileUrl.mock.calls.length).toBeLessThan(80)
  })

  test("opens direct image previews with visible-result navigation and metadata", () => {
    const imageGroup: CzkawkaGroup = {
      ...group,
      entries: [entry("a.jpg", "Alpha"), entry("track.mp3", "Track"), entry("b.avif", "Beta")],
    }
    render(<CzkawkaResultTable tool="similar-images" groups={[imageGroup]} running={false} selectedPaths={[]} getFileUrl={(path) => `http://local/${path}`} onSelectionChange={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: "预览 a.jpg" }))
    const dialog = within(screen.getByRole("dialog"))
    expect(dialog.getByRole("heading", { name: "a.jpg" })).toBeTruthy()
    expect(dialog.getByText("1920×1080")).toBeTruthy()
    expect(dialog.getByText("10 B")).toBeTruthy()
    expect(dialog.getByText("1 / 2")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "下一张图片" }))
    expect(dialog.getByRole("heading", { name: "b.avif" })).toBeTruthy()
    expect(dialog.getByText("2 / 2")).toBeTruthy()
  })

  test("renders an inline persistent preview mode without opening a dialog", () => {
    const onPreviewPanelEnabledChange = vi.fn()
    const imageGroup: CzkawkaGroup = { ...group, entries: [entry("a.jpg", "Alpha"), entry("b.avif", "Beta")] }
    const props = { tool: "similar-images" as const, groups: [imageGroup], running: false, selectedPaths: [], getFileUrl: (path: string) => `http://local/${path}`, onPreviewPanelEnabledChange, onSelectionChange: vi.fn() }
    const view = render(<CzkawkaResultTable {...props} previewPanelEnabled />)

    fireEvent.click(screen.getByRole("button", { name: "预览 a.jpg" }))
    expect(screen.getByTestId("local-media-preview-panel")).toBeTruthy()
    expect(screen.getByText("固定预览 · a.jpg")).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "下一张固定预览" }))
    expect(screen.getByText("固定预览 · b.avif")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "关闭固定预览" }))
    expect(screen.queryByTestId("local-media-preview-panel")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "禁用固定预览" }))
    expect(onPreviewPanelEnabledChange).toHaveBeenCalledWith(false)
    view.rerender(<CzkawkaResultTable {...props} previewPanelEnabled={false} />)
    fireEvent.click(screen.getByRole("button", { name: "预览 a.jpg" }))
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  test("routes fixed preview mode to reusable video and audio players", () => {
    const mediaGroup: CzkawkaGroup = { ...group, entries: [entry("clip.mp4", "Clip"), entry("track.flac", "Track")] }
    render(<CzkawkaResultTable tool="duplicate-music" groups={[mediaGroup]} running={false} selectedPaths={[]} previewPanelEnabled getFileUrl={(path) => `http://local/${path}`} onPreviewPanelEnabledChange={vi.fn()} onSelectionChange={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: "播放 clip.mp4" }))
    expect(screen.getByTestId("local-media-preview-panel").querySelector("video")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "关闭固定预览" }))
    fireEvent.click(screen.getByRole("button", { name: "播放 track.flac" }))
    expect(screen.getByTestId("local-media-preview-panel").querySelector("audio")).toBeTruthy()
  })

  test("uses the shared media cell and navigates visible video results", () => {
    const mediaGroup: CzkawkaGroup = {
      ...group,
      entries: [entry("a.mp4", "Alpha"), entry("cover.jpg", "Cover"), entry("b.webm", "Beta"), entry("track.flac", "Track")],
    }
    render(<CzkawkaResultTable tool="similar-videos" groups={[mediaGroup]} running={false} selectedPaths={[]} getFileUrl={(path) => `http://local/${path}`} onSelectionChange={vi.fn()} />)

    expect(screen.getByRole("button", { name: "预览 cover.jpg" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "播放 track.flac" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "播放 a.mp4" }))
    const dialog = within(screen.getByRole("dialog"))
    expect(dialog.getByRole("heading", { name: "a.mp4" })).toBeTruthy()
    expect(dialog.getByText("1 / 2")).toBeTruthy()
    expect(dialog.getByText("1920×1080")).toBeTruthy()

    fireEvent.click(dialog.getByRole("button", { name: "下一个视频" }))
    expect(dialog.getByRole("heading", { name: "b.webm" })).toBeTruthy()
    expect(dialog.getByText("2 / 2")).toBeTruthy()
  })

  test("plays duplicate audio with tag and fingerprint scan metadata", () => {
    const audioGroup: CzkawkaGroup = {
      ...group,
      entries: [
        { ...entry("a.flac", "Song A"), genre: "Rock", year: "2025" },
        { ...entry("b.mp3", "Song B"), genre: "Jazz", year: "2024" },
      ],
    }
    render(<CzkawkaResultTable tool="duplicate-music" groups={[audioGroup]} running={false} selectedPaths={[]} musicCheckType="fingerprint" musicMaximumDifference="7.5" musicMinimumFragmentDuration="20" musicCompareFingerprintsOnlyWithSimilarTitles getFileUrl={(path) => `http://local/${path}`} onSelectionChange={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: "播放 a.flac" }))
    const dialog = within(screen.getByRole("dialog"))
    expect(dialog.getByRole("heading", { name: "a.flac" })).toBeTruthy()
    expect(dialog.getByText("音频指纹")).toBeTruthy()
    expect(dialog.getByText("7.5")).toBeTruthy()
    expect(dialog.getByText("20 s")).toBeTruthy()
    expect(dialog.getByText("仅相似标题")).toBeTruthy()
    expect(dialog.getByText("Song A")).toBeTruthy()
    expect(dialog.getByText("Artist")).toBeTruthy()
    expect(dialog.getByText("Rock")).toBeTruthy()
    expect(dialog.getByText("320 kbps")).toBeTruthy()
    expect(dialog.getByText("03:00")).toBeTruthy()

    fireEvent.click(dialog.getByRole("button", { name: "下一个音频" }))
    expect(dialog.getByRole("heading", { name: "b.mp3" })).toBeTruthy()
    expect(dialog.getByText("2 / 2")).toBeTruthy()
  })

  test("selects virtual rows by dragging a box", () => {
    const onSelectionChange = vi.fn()
    const { container } = render(<CzkawkaResultTable tool="empty-files" groups={[group]} running={false} selectedPaths={[]} onSelectionChange={onSelectionChange} />)
    const body = container.querySelector('[data-slot="table-body"]') as HTMLElement
    vi.spyOn(body, "getBoundingClientRect").mockReturnValue({ x: 0, y: 40, top: 40, left: 0, right: 800, bottom: 144, width: 800, height: 104, toJSON: () => ({}) })
    fireEvent.pointerDown(body, { button: 0, pointerId: 7, clientY: 41 })
    expect(screen.getByTestId("czkawka-selection-box")).toBeTruthy()
    fireEvent.pointerMove(body, { pointerId: 7, clientY: 143 })
    fireEvent.pointerUp(body, { pointerId: 7, clientY: 143 })
    expect(onSelectionChange).toHaveBeenLastCalledWith(["a.mp3", "b.mp3"])
  })

  test("offers row context actions through reusable host callbacks", async () => {
    const onCopyText = vi.fn(async () => undefined)
    const onCopyFiles = vi.fn(async () => undefined)
    const onOpenPath = vi.fn(async () => undefined)
    const onRevealPath = vi.fn(async () => undefined)
    const { container } = render(<CzkawkaResultTable tool="empty-files" groups={[group]} running={false} selectedPaths={[]} onSelectionChange={vi.fn()} onCopyText={onCopyText} onCopyFiles={onCopyFiles} onOpenPath={onOpenPath} onRevealPath={onRevealPath} />)
    const row = container.querySelector('[data-index="a.mp3"]') as HTMLElement
    fireEvent.contextMenu(row)
    fireEvent.click(await screen.findByText("复制路径"))
    expect(onCopyText).toHaveBeenCalledWith("a.mp3")

    fireEvent.contextMenu(row)
    fireEvent.click(await screen.findByText("复制名称"))
    expect(onCopyText).toHaveBeenCalledWith("a.mp3")

    fireEvent.contextMenu(row)
    fireEvent.click(await screen.findByText("打开"))
    expect(onOpenPath).toHaveBeenCalledWith("a.mp3")

    fireEvent.contextMenu(row)
    fireEvent.click(await screen.findByText("在文件管理器中定位"))
    expect(onRevealPath).toHaveBeenCalledWith("a.mp3")

    fireEvent.contextMenu(row)
    fireEvent.click(await screen.findByText("复制文件"))
    expect(onCopyFiles).toHaveBeenCalledWith(["a.mp3"])
  })

  test("disables file-object copy when the host does not expose the capability", async () => {
    const { container } = render(<CzkawkaResultTable tool="empty-files" groups={[group]} running={false} selectedPaths={[]} onSelectionChange={vi.fn()} />)
    fireEvent.contextMenu(container.querySelector('[data-index="a.mp3"]') as HTMLElement)
    expect((await screen.findByText("复制文件")).getAttribute("data-disabled")).not.toBeNull()
  })

  test("keeps a controlled header filter synchronized with the table filter", () => {
    const onFilterTextChange = vi.fn()
    const view = render(<CzkawkaResultTable tool="empty-files" groups={[group]} running={false} filterText="Alpha" selectedPaths={[]} onFilterTextChange={onFilterTextChange} onSelectionChange={vi.fn()} />)
    expect((screen.getByRole("textbox", { name: "筛选结果" }) as HTMLInputElement).value).toBe("Alpha")
    fireEvent.change(screen.getByRole("textbox", { name: "筛选结果" }), { target: { value: "b.mp3" } })
    expect(onFilterTextChange).toHaveBeenCalledWith("b.mp3")
    view.rerender(<CzkawkaResultTable tool="empty-files" groups={[group]} running={false} filterText="b.mp3" selectedPaths={[]} onFilterTextChange={onFilterTextChange} onSelectionChange={vi.fn()} />)
    expect(view.container.textContent).toContain("b.mp3")
    expect(view.container.textContent).not.toContain("a.mp3")
  })

  test("renders group tracks and recoverable error and stopped states", () => {
    const retry = vi.fn(async () => undefined)
    const grouped = [group, { ...group, id: 1, entries: [entry("c.mp3", "Gamma")] }]
    const view = render(<CzkawkaResultTable tool="empty-files" groups={grouped} running={false} phase="error" statusMessage="Scanner failed" selectedPaths={[]} onRetry={retry} onSelectionChange={vi.fn()} />)
    expect(view.container.querySelectorAll('[data-group-start="true"]')).toHaveLength(2)
    expect(screen.getByRole("alert").textContent).toContain("Scanner failed")
    fireEvent.click(screen.getByRole("button", { name: /重新扫描/ }))
    expect(retry).toHaveBeenCalledTimes(1)

    view.rerender(<CzkawkaResultTable tool="empty-files" groups={[]} running={false} phase="stopped" statusMessage="Stopped by user" selectedPaths={[]} onRetry={retry} onSelectionChange={vi.fn()} />)
    expect(screen.getByRole("status").textContent).toContain("Stopped by user")
    expect(screen.getByText("扫描已停止，没有返回结果。")).toBeTruthy()
  })
})

const entries: CzkawkaEntry[] = [entry("a.mp3", "Alpha"), entry("b.mp3", "Beta")]
const group: CzkawkaGroup = { id: 0, entries, totalBytes: 30, reclaimableBytes: 10 }
function entry(path: string, title: string): CzkawkaEntry { return { id: path, groupId: 0, path, name: path, size: path.startsWith("a") ? 10 : 20, modifiedDate: 1, title, artist: "Artist", bitrate: 320, length: "03:00", width: 1920, height: 1080, similarity: "98%" } }
