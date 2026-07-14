// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import { createDefaultCzkawkaFilterState, type CzkawkaFilterStats } from "@xiranite/node-czkawka/filters"
import { CzkawkaFilterPanel } from "./filter-panel"

afterEach(cleanup)

const stats: CzkawkaFilterStats = {
  totalItems: 8,
  filteredItems: 3,
  totalGroups: 3,
  filteredGroups: 2,
  totalBytes: 1_000,
  filteredBytes: 500,
  selectedItems: 1,
  activeFilterCount: 0,
  extensions: [{ extension: "jpg", totalCount: 5, filteredCount: 2, totalBytes: 700, filteredBytes: 400 }],
}

describe("CzkawkaFilterPanel", () => {
  test("edits shared text and extension state and exposes live statistics", () => {
    const onChange = vi.fn()
    const state = createDefaultCzkawkaFilterState()
    render(<CzkawkaFilterPanel tool="duplicate-files" state={state} stats={stats} onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: "打开多维筛选" }))
    expect(screen.getByText("3/8 文件 · 2/3 组 · 500 B")).toBeTruthy()

    fireEvent.change(screen.getByRole("textbox", { name: "快速文本模式" }), { target: { value: "archive" } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ text: expect.objectContaining({ enabled: true, pattern: "archive" }) }))

    fireEvent.click(screen.getByRole("button", { name: /jpg 2\/5/ }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ extension: expect.objectContaining({ enabled: true, extensions: ["jpg"] }) }))
  })

  test("shows media-only filters and resets all categories", () => {
    const onChange = vi.fn()
    const state = createDefaultCzkawkaFilterState()
    state.fileSize.enabled = true
    render(<CzkawkaFilterPanel tool="similar-images" state={state} stats={{ ...stats, activeFilterCount: 1 }} pathPatternError="bad expression" onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: "打开多维筛选" }))
    expect(screen.getByText("相似度（%）")).toBeTruthy()
    expect(screen.getByText("分辨率 / 宽高比")).toBeTruthy()
    expect(screen.getByRole("alert").textContent).toContain("bad expression")
    fireEvent.click(screen.getByRole("button", { name: /重置/ }))
    expect(onChange).toHaveBeenLastCalledWith(createDefaultCzkawkaFilterState())
  })
})
