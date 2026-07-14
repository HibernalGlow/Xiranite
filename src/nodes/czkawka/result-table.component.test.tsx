// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { cleanup } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import type { CzkawkaEntry, CzkawkaGroup } from "@xiranite/node-czkawka/core"
import { CzkawkaResultTable } from "./result-table"

afterEach(cleanup)

describe("CzkawkaResultTable", () => {
  test("renders media-specific columns and keeps filters isolated by tool", () => {
    const props = { groups: [group], running: false, selectedPaths: [], onSelectionChange: vi.fn() }
    const view = render(<CzkawkaResultTable tool="duplicate-music" {...props} />)
    expect(screen.getByRole("button", { name: /标题/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /艺术家/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /码率/ })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /标题/ }))
    fireEvent.click(screen.getByRole("button", { name: /标题/ }))
    expect(screen.getByRole("button", { name: /标题/ }).querySelector(".lucide-arrow-down")).toBeTruthy()
    fireEvent.change(screen.getByRole("textbox", { name: "filter results" }), { target: { value: "needle" } })

    view.rerender(<CzkawkaResultTable tool="similar-images" {...props} />)
    expect((screen.getByRole("textbox", { name: "filter results" }) as HTMLInputElement).value).toBe("")
    expect(screen.getByRole("button", { name: /相似度/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /分辨率/ })).toBeTruthy()

    view.rerender(<CzkawkaResultTable tool="duplicate-music" {...props} />)
    expect((screen.getByRole("textbox", { name: "filter results" }) as HTMLInputElement).value).toBe("needle")
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
    const renderedRows = container.querySelectorAll('[data-slot="table-body"] [data-slot="table-row"]')
    expect(renderedRows.length).toBeGreaterThan(0)
    expect(renderedRows.length).toBeLessThan(80)
    expect((container.querySelector('[data-slot="table-body"]') as HTMLElement).style.height).toBe("520000px")
    const viewport = screen.getByTestId("czkawka-result-viewport")
    viewport.scrollTop = 4_236
    fireEvent.scroll(viewport)
    await waitFor(() => expect(container.textContent).toContain("file-73.mp3"))
    expect(container.querySelectorAll('[data-slot="table-body"] [data-slot="table-row"]').length).toBeLessThan(80)
  })

  test("resizes columns without changing the fixed preview row height", () => {
    const view = render(<CzkawkaResultTable tool="empty-files" groups={[group]} running={false} selectedPaths={[]} onSelectionChange={vi.fn()} />)
    const handle = screen.getByRole("separator", { name: "调整名称列宽" })
    expect((handle.parentElement as HTMLElement).style.width).toBe("160px")
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 180 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 180 })
    expect((handle.parentElement as HTMLElement).style.width).toBe("240px")
    expect((view.container.querySelector('[data-slot="table-body"] [data-slot="table-row"]') as HTMLElement).style.height).toBe("52px")
  })
})

const entries: CzkawkaEntry[] = [entry("a.mp3", "Alpha"), entry("b.mp3", "Beta")]
const group: CzkawkaGroup = { id: 0, entries, totalBytes: 30, reclaimableBytes: 10 }
function entry(path: string, title: string): CzkawkaEntry { return { id: path, groupId: 0, path, name: path, size: path.startsWith("a") ? 10 : 20, modifiedDate: 1, title, artist: "Artist", bitrate: 320, length: "03:00", width: 1920, height: 1080, similarity: "98%" } }
