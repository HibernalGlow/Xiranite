// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, test } from "vitest"
import type { CzkawkaEntry, CzkawkaGroup } from "@xiranite/node-czkawka/core"
import { CzkawkaAnalysisView } from "./analysis-panel"

afterEach(cleanup)

describe("CzkawkaAnalysisView", () => {
  test("renders a format donut, byte bars, similarity levels, and live selection stats", () => {
    render(<CzkawkaAnalysisView tool="similar-images" groups={[group]} selectedPaths={["b.png"]} hashSize={16} />)
    expect(screen.getByRole("img", { name: "格式体积环形图" })).toBeTruthy()
    expect(screen.getAllByText(/\.png/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/\.jpg/).length).toBeGreaterThan(0)
    expect(screen.getByText("原始/相同")).toBeTruthy()
    expect(screen.getByText("高")).toBeTruthy()
    expect(screen.getAllByText("20 B")).toHaveLength(2)
    expect(screen.getByText("预计")).toBeTruthy()
  })

  test("makes the missing similar-video distance explicit", () => {
    render(<CzkawkaAnalysisView tool="similar-videos" groups={[{ ...group, entries: group.entries.map((item) => ({ ...item, similarity: undefined })) }]} selectedPaths={[]} />)
    expect(screen.getByText("核心未返回视频距离值")).toBeTruthy()
  })
})

const entries: CzkawkaEntry[] = [entry("a.jpg", 10, ""), entry("b.png", 20, "5"), entry("c.png", 30, undefined)]
const group: CzkawkaGroup = { id: 0, entries, totalBytes: 60, reclaimableBytes: 40 }
function entry(path: string, size: number, similarity: string | undefined): CzkawkaEntry { return { id: path, groupId: 0, path, name: path, size, modifiedDate: 1, similarity } }
