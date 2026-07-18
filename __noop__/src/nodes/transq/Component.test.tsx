// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { TransqData, TransqInput, TransqQueueItem } from "@xiranite/node-transq/core"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import { Component } from "./Component"
import type { TransqCardState } from "./types"

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

describe("native TransQ component", () => {
  test.each(NODE_SURFACE_TEST_MODES)("renders the %s queue surface without PackU configuration", (mode) => {
    setSurface(mode)
    render(<Component compId="comp-transq" host={createHost({ pathsText: "D:/translation/project", preview: true, result: transqData })} />)

    expect(screen.getByText("TransQ")).toBeTruthy()
    expect(screen.queryByText(/PackU/i)).toBeNull()
    expect(screen.queryByLabelText(/Python/i)).toBeNull()
    expect(screen.queryByLabelText(/额外参数/i)).toBeNull()

    if (mode === "collapsed") {
      expect(screen.getByTestId("transq-collapsed-view")).toBeTruthy()
      expect(screen.queryByTestId("transq-execution-gate")).toBeNull()
      return
    }

    expect(screen.getByLabelText("transq 翻译工作区")).toBeTruthy()
    expect(screen.getByTestId("transq-execution-gate")).toBeTruthy()
    expect(screen.getByRole("switch", { name: "transq 预演开关" })).toBeTruthy()
    expect(screen.getByTestId("transq-queue-board")).toBeTruthy()

    if (mode === "compact") expect(screen.getByTestId("transq-compact-view")).toBeTruthy()
    else if (mode === "portrait") expect(screen.getByTestId("transq-portrait-view")).toBeTruthy()
    else {
      expect(screen.getByTestId("transq-full-view")).toBeTruthy()
      expect(screen.getByTestId("transq-header-toolbar")).toBeTruthy()
      expect(screen.getByText("队列看板")).toBeTruthy()
      expect(screen.getByText("原生整理规则")).toBeTruthy()
    }
  })

  test("runs the visible preview gate with native TransQ input only", async () => {
    setSurface("regular")
    const host = createHost({ pathsText: "D:/translation/project", preview: true, logs: [] })
    render(<Component compId="comp-transq" host={host} />)
    const user = userEvent.setup()

    const gate = screen.getByTestId("transq-execution-gate")
    expect(within(gate).getByText("预演：不改动文件")).toBeTruthy()
    await user.click(within(gate).getByRole("button", { name: "预演队列" }))

    await waitFor(() => expect(host.runCalls).toEqual([{
      nodeId: "transq",
      input: { action: "run", paths: ["D:/translation/project"], preview: true },
    }]))
    await waitFor(() => expect(host.cardState.phase).toBe("completed"))
  })

  test("keeps live mode beside its destructive action and confirms before organizing", async () => {
    setSurface("regular")
    const host = createHost({ pathsText: "D:/translation/project", preview: false, logs: [] })
    render(<Component compId="comp-transq" host={host} />)
    const user = userEvent.setup()

    const gate = screen.getByTestId("transq-execution-gate")
    expect(within(gate).getByText("真实执行：移动结果并删除原工作目录")).toBeTruthy()
    await user.click(within(gate).getByRole("button", { name: "整理队列" }))

    expect(host.runCalls).toHaveLength(0)
    expect(screen.getByText("确认整理翻译队列？")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "确认整理" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "transq",
      input: { action: "run", paths: ["D:/translation/project"], preview: false },
    })
  })
})

type TestHost = NodeHostApi<TransqCardState, Partial<TransqCardState>> & {
  copiedText: string
  runCalls: Array<{ nodeId: string; input: TransqInput }>
  cardState: TransqCardState
}

function createHost(initial: TransqCardState): TestHost {
  const stateCapability = {
    getData: () => host.cardState,
    patchData: (patch: Partial<TransqCardState>) => {
      host.cardState = { ...host.cardState, ...patch }
    },
  }

  const host: TestHost = {
    cardState: { ...initial },
    runCalls: [],
    copiedText: "",
    contract: {
      name: "xiranite.node-host",
      version: "1.0.0",
      supportedCapabilities: ["contract", "state", "runner", "clipboard", "env"],
      hasCapability: (capability) => ["contract", "state", "runner", "clipboard", "env"].includes(capability),
    },
    env: { theme: "light", platform: "web" },
    state: stateCapability,
    runner: {
      run: async <TInput, TData>(nodeId: string, input: TInput, onEvent?: (event: NodeRunEvent) => void): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as TransqInput })
        onEvent?.({ type: "progress", progress: 50, message: "Planning native TransQ queue." })
        return { success: true, message: "TransQ queue ready.", data: transqData as TData }
      },
    },
    clipboard: {
      readText: async () => "D:/translation/project",
      writeText: async (text) => { host.copiedText = text },
    },
    getData: <T,>() => stateCapability.getData() as T | undefined,
    patchData: (_compId, patch) => stateCapability.patchData(patch),
    listComponents: () => [],
    updateComponent: () => undefined,
    actions: undefined,
  }
  return host
}

function setSurface(mode: NodeSurfaceMode) {
  const size = NODE_SURFACE_TEST_SPECS[mode]
  surfaceState.width = size.width
  surfaceState.height = size.height
}

const queueItem: TransqQueueItem = {
  id: "D:/translation/chapter/original_images",
  originalImagesPath: "D:/translation/chapter/original_images",
  resultPath: "D:/translation/chapter/original_images/manga_translator_work/result",
  outputPath: "D:/translation/chapter/result",
  status: "pending",
  originalCount: 2,
  resultCount: 1,
  missingFiles: ["002.png"],
  extraFiles: [],
  copies: [{
    filename: "002.png",
    sourcePath: "D:/translation/chapter/original_images/002.png",
    destinationPath: "D:/translation/chapter/original_images/manga_translator_work/result/002.png",
  }],
  cleanupPaths: ["D:/translation/chapter/original_images/manga_translator_work/inpainted"],
  errors: [],
}

const transqData: TransqData = {
  items: [queueItem],
  pendingCount: 1,
  readyCount: 0,
  outputCount: 0,
  conflictCount: 0,
  copiedFiles: 0,
  deletedOriginals: 0,
  deletedWorkItems: 0,
  errors: [],
}
