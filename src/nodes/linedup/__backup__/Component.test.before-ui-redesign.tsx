// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi } from "@xiranite/contract"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import { Component } from "./Component"
import type { LinedupCardState } from "./types"

const surfaceState = vi.hoisted(() => ({
  height: 420,
  width: 720,
}))

vi.mock("@/nodes/shared/useNodeSurface", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/nodes/shared/useNodeSurface")>()
  return {
    ...actual,
    useNodeSurface: () => {
      const mode = actual.resolveNodeSurfaceMode(surfaceState)
      return {
        ref: { current: null },
        width: surfaceState.width,
        height: surfaceState.height,
        mode,
        density: actual.resolveNodeSurfaceDensity(mode),
      }
    },
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  setSurface("regular")
})

describe("app-owned linedup Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)("renders the %s surface with Linedup-specific UI", (mode) => {
    setSurface(mode)
    render(<Component compId="comp-linedup" host={createHost({ sourceText: sourceText(), filterText: "beta" })} />)

    expect(screen.getByText("Linedup")).toBeTruthy()
    if (mode === "collapsed") {
      expect(screen.getByTestId("linedup-collapsed-view")).toBeTruthy()
      expect(screen.queryByLabelText("源文本")).toBeNull()
      return
    }

    expect(screen.getByLabelText("源文本")).toBeTruthy()
    expect(screen.getByLabelText("过滤词")).toBeTruthy()
    expect(screen.getByRole("tab", { name: /预览/ })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /保留/ })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /移除/ })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /日志/ })).toBeTruthy()

    if (mode === "compact") {
      expect(screen.getByTestId("linedup-compact-view")).toBeTruthy()
      expect(screen.getByRole("button", { name: "linedup options" })).toBeTruthy()
    } else if (mode === "portrait") {
      expect(screen.getByTestId("linedup-portrait-view")).toBeTruthy()
    } else {
      expect(screen.getByTestId("linedup-full-view")).toBeTruthy()
      expect(screen.getByTestId("linedup-header-toolbar")).toBeTruthy()
      expect(screen.getAllByText("进度").length).toBeGreaterThan(0)
    }
  })

  test("forces collapsed content when compact surface height is too short", () => {
    setSurfaceSize({ width: 420, height: 159 })

    render(<Component compId="comp-linedup" host={createHost({ sourceText: sourceText(), filterText: "beta" })} />)

    expect(screen.getByTestId("linedup-collapsed-view")).toBeTruthy()
    expect(screen.queryByLabelText("源文本")).toBeNull()
  })

  test("uses portrait compact layout for tall compact surfaces", () => {
    setSurfaceSize({ width: 559, height: 300 })

    render(<Component compId="comp-linedup" host={createHost({ sourceText: sourceText(), filterText: "beta" })} />)

    expect(screen.getByTestId("linedup-portrait-view")).toBeTruthy()
    expect(screen.queryByTestId("linedup-compact-view")).toBeNull()
  })

  test("pastes input, filters locally, then copies and downloads kept lines", async () => {
    setSurface("regular")
    const host = createHost({}, { clipboard: [sourceText(), "beta"] })
    const view = render(<Component compId="comp-linedup" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "粘贴源文本" }))
    view.rerender(<Component compId="comp-linedup" host={host} />)
    await user.click(screen.getByRole("button", { name: "粘贴过滤词" }))
    view.rerender(<Component compId="comp-linedup" host={host} />)
    expect(host.state.sourceText).toBe(sourceText())
    expect(host.state.filterText).toBe("beta")

    await user.click(screen.getByRole("button", { name: "运行过滤" }))
    view.rerender(<Component compId="comp-linedup" host={host} />)

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.result?.keptCount).toBe(2)
    expect(host.state.result?.removedCount).toBe(2)
    expect(host.state.logs).toEqual(["保留 2 行，移除 2 行。"])
    expect(screen.getByText("beta-one")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "复制保留结果" }))
    expect(host.copiedText).toBe("alpha\ngamma")

    await user.click(screen.getByRole("tab", { name: /保留/ }))
    await user.click(screen.getByRole("button", { name: "下载" }))
    expect(host.downloads).toEqual([{ filename: "linedup-output.txt", content: "alpha\ngamma" }])
  })

  test("supports case-insensitive filtering from the options popover", async () => {
    setSurface("regular")
    const host = createHost({ sourceText: "Alpha\nBeta\ngamma", filterText: "beta", caseSensitive: false })
    render(<Component compId="comp-linedup" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "运行过滤" }))

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.result?.filteredLines).toEqual(["Alpha", "gamma"])
    expect(host.state.result?.removedLines).toEqual(["Beta"])
  })

  test("keeps the run action disabled until source text is available", () => {
    setSurface("regular")
    const host = createHost({ filterText: "beta" })
    render(<Component compId="comp-linedup" host={host} />)

    expect((screen.getByRole("button", { name: "运行过滤" }) as HTMLButtonElement).disabled).toBe(true)
    expect(host.state.phase).toBeUndefined()
  })
})

type TestHost = NodeHostApi & {
  clipboardQueue: string[]
  copiedText: string
  downloads: Array<{ filename: string; content: string }>
  state: LinedupCardState
}

function createHost(initial: LinedupCardState, options: { clipboard?: string[] } = {}): TestHost {
  const host: TestHost = {
    state: { ...initial },
    clipboardQueue: [...(options.clipboard ?? [])],
    copiedText: "",
    downloads: [],
    getData: <T,>() => host.state as T,
    patchData: (_compId, patch) => {
      host.state = { ...host.state, ...patch }
    },
    listComponents: () => [],
    updateComponent: () => undefined,
    clipboard: {
      readText: async () => host.clipboardQueue.shift() ?? "",
      writeText: async (text) => {
        host.copiedText = text
      },
    },
    downloadText: (filename, content) => {
      host.downloads.push({ filename, content })
    },
    env: {
      theme: "light",
      platform: "web",
    },
  }
  return host
}

function setSurface(mode: NodeSurfaceMode) {
  setSurfaceSize(NODE_SURFACE_TEST_SPECS[mode])
}

function setSurfaceSize(size: { height: number; width: number }) {
  surfaceState.width = size.width
  surfaceState.height = size.height
}

function sourceText(): string {
  return "gamma\nbeta-one\nalpha\nbeta-two"
}
