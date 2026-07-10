// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { ClassqData, ClassqInput } from "@xiranite/node-classq/core"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import { Component } from "./Component"
import type { ClassqCardState } from "./types"

const surfaceState = vi.hoisted(() => ({ height: 420, width: 720 }))

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

describe("app-owned classq Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)(
    "renders the %s surface with native ClassQ UI",
    (mode) => {
      setSurface(mode)
      render(<Component compId="comp-classq" host={createHost({ pathsText: "D:/set" })} />)

      expect(screen.getByText("ClassQ")).toBeTruthy()
      expect(screen.getByTestId("classq-surface").className).not.toContain("bg-card")
      if (mode === "collapsed") {
        expect(screen.getByTestId("classq-collapsed-view")).toBeTruthy()
        expect(screen.queryByLabelText("classq roots")).toBeNull()
        return
      }

      expect(screen.getByLabelText("classq roots")).toBeTruthy()
      expect(within(screen.getByTestId("classq-mode-tabs")).getAllByRole("tab")).toHaveLength(2)
      expect(within(screen.getByTestId("classq-result-list")).getAllByRole("tab")).toHaveLength(3)

      if (mode === "compact") {
        expect(screen.getByTestId("classq-compact-view")).toBeTruthy()
      } else if (mode === "portrait") {
        expect(screen.getByTestId("classq-portrait-view")).toBeTruthy()
      } else {
        expect(screen.getByTestId("classq-full-view")).toBeTruthy()
        expect(screen.getByTestId("classq-header-toolbar")).toBeTruthy()
        expect(screen.getByTestId("classq-command-deck")).toBeTruthy()
        expect(screen.getByTestId("classq-spatial-workbench")).toBeTruthy()
        expect(within(screen.getByTestId("classq-header-toolbar")).queryAllByRole("tab")).toHaveLength(0)
        expect(screen.getByRole("button", { name: "扫描根目录" })).toBeTruthy()
      }
    },
  )

  test("runs scan through host.runner.run and stores grouped wait rows", async () => {
    setSurface("regular")
    const host = createHost({
      action: "plan",
      pathsText: "D:/set",
      keyword: "already",
      waitKeyword: "wait",
      transferMode: "move",
      dryRun: true,
      logs: [],
    })
    render(<Component compId="comp-classq" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "扫描根目录" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "classq",
      input: {
        action: "plan",
        paths: ["D:/set"],
        keyword: "already",
        waitKeyword: "wait",
        transferMode: "move",
        existingPolicy: "merge",
        dryRun: true,
      },
    })
    await waitFor(() => expect(host.cardState.phase).toBe("completed"))
    expect(host.cardState.result?.items[1]?.targetRelative).toBe("wait/pending.zip")
  })

  test("requires confirmation before live classify execution", async () => {
    setSurface("regular")
    const host = createHost({ action: "classify", pathsText: "D:/set", dryRun: false, logs: [] })
    render(<Component compId="comp-classq" host={host} />)
    const user = userEvent.setup()

    const executeButton = screen.getByRole("button", { name: "执行分类" })
    expect(executeButton.getAttribute("data-variant")).toBe("destructive")
    await user.click(executeButton)
    expect(host.runCalls).toHaveLength(0)

    const dialog = screen.getByRole("alertdialog")
    await user.click(within(dialog).getByRole("button", { name: "确认分类" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("classify")
    expect(host.runCalls[0]?.input.dryRun).toBe(false)
  })

  test("switches mode tabs and runs preview classify from the active mode panel", async () => {
    setSurface("regular")
    const host = createHost({ action: "plan", pathsText: "D:/set", dryRun: true, logs: [] })
    render(<Component compId="comp-classq" host={host} />)
    const user = userEvent.setup()
    const modeTabs = screen.getByTestId("classq-mode-tabs")

    expect(within(modeTabs).getByRole("button", { name: "扫描根目录" }).getAttribute("data-variant")).toBe("secondary")
    await user.click(within(modeTabs).getByRole("tab", { name: "分类" }))

    expect(within(modeTabs).getByRole("tab", { name: "分类" }).getAttribute("aria-selected")).toBe("true")
    const previewButton = within(modeTabs).getByRole("button", { name: "预览分类" })
    expect(previewButton.getAttribute("data-variant")).toBe("default")
    await user.click(previewButton)

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("classify")
    expect(host.runCalls[0]?.input.dryRun).toBe(true)
  })

  test("uses a horizontal result tab list inside the result panel", async () => {
    setSurface("regular")
    render(<Component compId="comp-classq" host={createHost({ pathsText: "D:/set", logs: ["scan complete"] })} />)
    const user = userEvent.setup()
    const list = screen.getByTestId("classq-result-list")

    expect(screen.getByTestId("classq-result-tabs").getAttribute("data-orientation")).toBe("horizontal")
    await user.click(within(list).getByRole("tab", { name: /日志/ }))

    expect(within(list).getByRole("tab", { name: /日志/ }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByText("scan complete")).toBeTruthy()
    expect(within(screen.getByTestId("classq-header-toolbar")).queryAllByRole("tab")).toHaveLength(0)
  })

  test("marks the card as error when run has no roots", async () => {
    setSurface("regular")
    const host = createHost({ action: "plan", logs: [] })
    render(<Component compId="comp-classq" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "扫描根目录" }))

    expect(host.runCalls).toHaveLength(0)
    await waitFor(() => expect(host.cardState.phase).toBe("error"))
    expect(host.cardState.progressText).toContain("root directory")
  })
})

type TestHost = NodeHostApi<ClassqCardState, Partial<ClassqCardState>> & {
  copiedText: string
  runCalls: Array<{ nodeId: string; input: ClassqInput }>
  savedConfig: Partial<ClassqCardState> | undefined
  cardState: ClassqCardState
}

function createHost(initial: ClassqCardState): TestHost {
  const stateCapability = {
    getData: () => host.cardState,
    patchData: (patch: Partial<ClassqCardState>) => {
      host.cardState = { ...host.cardState, ...patch }
    },
  }

  const host: TestHost = {
    cardState: { ...initial },
    runCalls: [],
    copiedText: "",
    savedConfig: undefined,
    contract: {
      name: "xiranite.node-host",
      version: "1.0.0",
      supportedCapabilities: ["contract", "state", "runner", "clipboard", "config", "env"],
      hasCapability: (capability) => ["contract", "state", "runner", "clipboard", "config", "env"].includes(capability),
    },
    env: { theme: "light", platform: "web" },
    state: stateCapability,
    runner: {
      run: async <TInput, TData>(
        nodeId: string,
        input: TInput,
        onEvent?: (event: NodeRunEvent) => void,
      ): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as ClassqInput })
        onEvent?.({ type: "progress", progress: 50, message: "Scanning keyword folders." })
        return {
          success: true,
          message: "ClassQ planned 2 items.",
          data: classqData as TData,
        }
      },
    },
    clipboard: {
      readText: async () => "D:/set",
      writeText: async (text) => { host.copiedText = text },
    },
    config: {
      get: async () => ({ config: undefined, path: "D:/config/xiranite.config.toml" }),
      save: async (config) => { host.savedConfig = config },
      openFile: () => undefined,
    },
    getData: <T,>() => stateCapability.getData() as T | undefined,
    patchData: (_compId, patch) => stateCapability.patchData(patch),
    listComponents: () => [],
    updateComponent: () => undefined,
    actions: undefined,
    getNodeConfig: async <T,>() => ({ config: undefined as T | undefined, path: "D:/config/xiranite.config.toml" }),
    saveNodeConfig: async (config) => { host.savedConfig = config as Partial<ClassqCardState> },
    openConfigFile: () => undefined,
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

const classqData: ClassqData = {
  action: "plan",
  keyword: "already",
  waitKeyword: "wait",
  transferMode: "move",
  items: [
    {
      rootPath: "D:/set",
      parentPath: "D:/set",
      keywordPath: "D:/set/already",
      sourcePath: "D:/set/already",
      targetPath: "D:/set/wait",
      sourceName: "already",
      targetRelative: "wait",
      kind: "folder",
      stage: "keyword",
      status: "found",
    },
    {
      rootPath: "D:/set",
      parentPath: "D:/set",
      keywordPath: "D:/set/already",
      sourcePath: "D:/set/pending.zip",
      targetPath: "D:/set/wait/pending.zip",
      sourceName: "pending.zip",
      targetRelative: "wait/pending.zip",
      kind: "file",
      stage: "wait",
      status: "ready",
    },
  ],
  rootCount: 1,
  keywordCount: 1,
  readyCount: 1,
  waitCount: 1,
  movedCount: 0,
  copiedCount: 0,
  conflictCount: 0,
  errorCount: 0,
  errors: [],
}
