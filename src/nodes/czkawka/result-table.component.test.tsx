// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react"
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
})

const entries: CzkawkaEntry[] = [entry("a.mp3", "Alpha"), entry("b.mp3", "Beta")]
const group: CzkawkaGroup = { id: 0, entries, totalBytes: 30, reclaimableBytes: 10 }
function entry(path: string, title: string): CzkawkaEntry { return { id: path, groupId: 0, path, name: path, size: path.startsWith("a") ? 10 : 20, modifiedDate: 1, title, artist: "Artist", bitrate: 320, length: "03:00", width: 1920, height: 1080, similarity: "98%" } }
