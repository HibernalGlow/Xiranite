// @vitest-environment happy-dom
import { useState } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import { createDefaultCzkawkaCardLayout } from "@xiranite/node-czkawka/card-layout"
import { CzkawkaCardManager, CzkawkaCardStack } from "./card-layout"

afterEach(cleanup)

describe("Czkawka card layout UI", () => {
  test("supports keyboard ordering, height, collapse, visibility, and cross-panel drag", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: "上移活动日志" }))
    expect(cardIds("analysis").slice(0, 3)).toEqual(["preview", "logs", "analysis"])
    fireEvent.change(screen.getByRole("slider", { name: "调整活动日志高度" }), { target: { value: "400" } })
    expect((document.querySelector('[data-card-id="logs"]') as HTMLElement).style.height).toBe("400px")
    fireEvent.click(screen.getByText("活动日志"))
    expect(screen.queryByRole("slider", { name: "调整活动日志高度" })).toBeNull()

    const transfer = { value: "", effectAllowed: "none", setData: vi.fn((_type: string, value: string) => { transfer.value = value }), getData: vi.fn(() => transfer.value) }
    fireEvent.dragStart(document.querySelector('[data-card-id="logs"]')!, { dataTransfer: transfer })
    fireEvent.drop(screen.getByTestId("czkawka-card-stack-source"), { dataTransfer: transfer })
    expect(cardIds("source")).toContain("logs")

    fireEvent.click(screen.getByRole("button", { name: "管理卡片" }))
    fireEvent.click(screen.getByRole("button", { name: "隐藏统计分析" }))
    expect(document.querySelector('[data-card-id="analysis"]')).toBeNull()
  })
})

function Harness() {
  const [layout, setLayout] = useState(createDefaultCzkawkaCardLayout)
  return <><CzkawkaCardManager layout={layout} onChange={setLayout} /><CzkawkaCardStack layout={layout} panel="source" onChange={setLayout} renderCard={(id) => <span>{id}</span>} /><CzkawkaCardStack layout={layout} panel="analysis" onChange={setLayout} renderCard={(id) => <span>{id}</span>} /></>
}
function cardIds(panel: string): string[] { return [...screen.getByTestId(`czkawka-card-stack-${panel}`).querySelectorAll("[data-card-id]")].map((element) => element.getAttribute("data-card-id")!) }
