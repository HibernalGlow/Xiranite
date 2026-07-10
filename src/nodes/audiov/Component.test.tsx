// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { AudiovData, AudiovInput } from "@xiranite/node-audiov/core"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import { Component } from "./Component"
import type { AudiovCardState } from "./types"

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

describe("native AudioV component", () => {
  test.each(NODE_SURFACE_TEST_MODES)("renders the %s surface with an always-visible execution control", (mode) => {
    setSurface(mode)
    render(<Component compId="comp-audiov" host={createHost({ pathsText: "D:/Video/clip.mp4" })} />)

    expect(screen.getByText("AudioV")).toBeTruthy()
    if (mode === "collapsed") {
      expect(screen.getByTestId("audiov-collapsed-view")).toBeTruthy()
      expect(screen.queryByTestId("audiov-execution-controls")).toBeNull()
      return
    }

    expect(screen.getByLabelText("audiov 视频路径")).toBeTruthy()
    expect(screen.getByTestId("audiov-execution-controls")).toBeTruthy()
    expect(screen.getByLabelText("audiov 预演切换")).toBeTruthy()
    expect(screen.queryByLabelText("audiov 额外参数")).toBeNull()
    expect(screen.queryByLabelText("audiov Python 可执行文件")).toBeNull()
  })

  test("sends a native fixed-profile plan without Python or arbitrary arguments", async () => {
    setSurface("regular")
    const host = createHost({ action: "plan", pathsText: "D:/Video/clip.mp4", dryRun: true, logs: [] })
    render(<Component compId="comp-audiov" host={host} />)
    const user = userEvent.setup()

    await user.click(within(screen.getByTestId("audiov-execution-controls")).getByRole("button", { name: "生成计划" }))

    await waitFor(() => expect(host.runCalls).toEqual([{
      nodeId: "audiov",
      input: { action: "plan", paths: ["D:/Video/clip.mp4"], dryRun: true },
    }]))
    await waitFor(() => expect(host.cardState.phase).toBe("completed"))
    expect(host.cardState.result?.command?.command).toBe("ffmpeg")
  })

  test("keeps preview state beside the execution action and requires confirmation before a live extraction", async () => {
    setSurface("regular")
    const host = createHost({ action: "run", pathsText: "D:/Video/clip.mp4", dryRun: false, logs: [] })
    render(<Component compId="comp-audiov" host={host} />)
    const user = userEvent.setup()

    const executionControls = screen.getByTestId("audiov-execution-controls")
    expect(within(executionControls).getByText("真实：将写入文件")).toBeTruthy()
    expect(within(executionControls).getByText("固定预设：AAC · 192 kbps · M4A")).toBeTruthy()
    await user.click(within(executionControls).getByRole("button", { name: "立即提取" }))
    expect(host.runCalls).toHaveLength(0)
    expect(screen.getByText("确认提取音轨？")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "确认提取" }))
    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input).toMatchObject({ action: "run", dryRun: false })
  })

  test("marks the card as an error when execution has no paths", async () => {
    setSurface("regular")
    const host = createHost({ action: "run", logs: [] })
    render(<Component compId="comp-audiov" host={host} />)
    const user = userEvent.setup()

    await user.click(within(screen.getByTestId("audiov-execution-controls")).getByRole("button", { name: "预览提取" }))

    expect(host.runCalls).toHaveLength(0)
    await waitFor(() => expect(host.cardState.phase).toBe("error"))
    expect(host.cardState.progressText).toContain("视频")
  })
})

type TestHost = NodeHostApi<AudiovCardState, Partial<AudiovCardState>> & {
  copiedText: string
  runCalls: Array<{ nodeId: string; input: AudiovInput }>
  savedConfig: Partial<AudiovCardState> | undefined
  cardState: AudiovCardState
}

function createHost(initial: AudiovCardState): TestHost {
  const stateCapability = {
    getData: () => host.cardState,
    patchData: (patch: Partial<AudiovCardState>) => {
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
      run: async <TInput, TData>(nodeId: string, input: TInput, onEvent?: (event: NodeRunEvent) => void): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as AudiovInput })
        onEvent?.({ type: "progress", progress: 50, message: "Planning AudioV extraction." })
        return { success: true, message: "AudioV plan ready.", data: audiovData as TData }
      },
    },
    clipboard: {
      readText: async () => "D:/Video/clip.mp4",
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
    saveNodeConfig: async (config) => { host.savedConfig = config as Partial<AudiovCardState> },
    openConfigFile: () => undefined,
  }
  return host
}

function setSurface(mode: NodeSurfaceMode) {
  const size = NODE_SURFACE_TEST_SPECS[mode]
  surfaceState.width = size.width
  surfaceState.height = size.height
}

const audiovData: AudiovData = {
  command: {
    label: "Extract audio: clip.mp4",
    command: "ffmpeg",
    args: ["-n", "-i", "D:/Video/clip.mp4", "-map", "0:a:0", "-vn", "-c:a", "aac", "-b:a", "192k", "D:/Video/clip.audio.m4a"],
    inputPath: "D:/Video/clip.mp4",
    outputPath: "D:/Video/clip.audio.m4a",
  },
  commands: [],
  commandResults: [],
  selectedPaths: ["D:/Video/clip.mp4"],
  outputPaths: [],
  errors: [],
}
