// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import type { JellyPotData, JellyPotInput } from "@xiranite/node-jellypot/core"
import { Component } from "./Component"
import type { JellyPotCardState } from "./types"

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

describe("app-owned jellypot Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)(
    "renders the %s surface with JellyPot-specific UI",
    (mode) => {
      setSurface(mode)
      render(<Component compId="comp-jellypot" host={createHost({ action: "launch_media", mediaPath: "D:/video.mkv" })} />)

      expect(screen.getByText("JellyPot")).toBeTruthy()
      if (mode === "collapsed") {
        expect(screen.getByTestId("jellypot-collapsed-view")).toBeTruthy()
        expect(screen.queryByLabelText("jellypot 媒体路径")).toBeNull()
        return
      }

      expect(screen.getByLabelText("jellypot 媒体路径")).toBeTruthy()
      expect(screen.getByRole("tab", { name: "检查" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "命令" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "日志" })).toBeTruthy()

      if (mode === "compact") {
        expect(screen.getByTestId("jellypot-compact-view")).toBeTruthy()
      } else if (mode === "portrait") {
        expect(screen.getByTestId("jellypot-portrait-view")).toBeTruthy()
      } else {
        expect(screen.getByTestId("jellypot-full-view")).toBeTruthy()
        expect(screen.getByTestId("jellypot-header-toolbar")).toBeTruthy()
        expect(screen.getByText("媒体入口")).toBeTruthy()
        expect(screen.getByText("最近活动")).toBeTruthy()
        expect(screen.getByText("注册表配置")).toBeTruthy()
      }
    },
  )

  test("runs launch_media through host.runner.run and stores command results", async () => {
    setSurface("regular")
    const host = createHost({
      action: "launch_media",
      mediaPath: "D:/video.mkv",
      potplayerPath: "D:/scoop/apps/potplayer/current/PotPlayerMini64.exe",
      dryRun: true,
      logs: [],
    })
    render(<Component compId="comp-jellypot" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "播放媒体" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "jellypot",
      input: {
        action: "launch_media",
        configPath: undefined,
        databasePath: undefined,
        mediaPath: "D:/video.mkv",
        potplayerPath: "D:/scoop/apps/potplayer/current/PotPlayerMini64.exe",
        browserPath: undefined,
        dryRun: true,
        recordRun: false,
      },
    })
    await waitFor(() => expect(host.cardState.phase).toBe("completed"))
    expect(host.cardState.result?.commands).toHaveLength(1)

    await user.click(screen.getByRole("tab", { name: "命令" }))
    expect(screen.getAllByText(/launch PotPlayer/).length).toBeGreaterThanOrEqual(1)
  })

  test("requires confirmation before real apply_registry execution", async () => {
    setSurface("regular")
    const host = createHost({ action: "apply_registry", dryRun: false, logs: [] })
    render(<Component compId="comp-jellypot" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "导入注册表" }))
    expect(host.runCalls).toHaveLength(0)
    expect(screen.getByText("确认导入注册表？")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "确认导入" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("apply_registry")
    expect(host.runCalls[0]?.input.dryRun).toBe(false)
  })

  test("marks the card as error when launch_media has no media path", async () => {
    setSurface("regular")
    const host = createHost({ action: "launch_media", logs: [] })
    render(<Component compId="comp-jellypot" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "播放媒体" }))

    expect(host.runCalls).toHaveLength(0)
    await waitFor(() => expect(host.cardState.phase).toBe("error"))
    expect(host.cardState.progressText).toContain("媒体路径")
  })
})

type TestHost = NodeHostApi<JellyPotCardState, Partial<JellyPotCardState>> & {
  copiedText: string
  runCalls: Array<{ nodeId: string; input: JellyPotInput }>
  savedConfig: Partial<JellyPotCardState> | undefined
  cardState: JellyPotCardState
}

function createHost(initial: JellyPotCardState): TestHost {
  const stateCapability = {
    getData: () => host.cardState,
    patchData: (patch: Partial<JellyPotCardState>) => {
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
    env: {
      theme: "light",
      platform: "web",
    },
    state: stateCapability,
    runner: {
      run: async <TInput, TData>(
        nodeId: string,
        input: TInput,
        onEvent?: (event: NodeRunEvent) => void,
      ): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as JellyPotInput })
        onEvent?.({ type: "progress", progress: 50, message: "Launching PotPlayer." })
        return {
          success: true,
          message: "JellyPot planned 1 command(s).",
          data: jellypotData as TData,
        }
      },
    },
    clipboard: {
      readText: async () => "D:/video.mkv",
      writeText: async (text) => {
        host.copiedText = text
      },
    },
    config: {
      get: async () => ({ config: undefined, path: "D:/config/xiranite.config.toml" }),
      save: async (config) => {
        host.savedConfig = config
      },
      openFile: () => undefined,
    },
    getData: <T,>() => stateCapability.getData() as T | undefined,
    patchData: (_compId, patch) => stateCapability.patchData(patch),
    listComponents: () => [],
    updateComponent: () => undefined,
    actions: undefined,
    getNodeConfig: async <T,>() => ({ config: undefined as T | undefined, path: "D:/config/xiranite.config.toml" }),
    saveNodeConfig: async (config) => {
      host.savedConfig = config as Partial<JellyPotCardState>
    },
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

const jellypotData: JellyPotData = {
  config: {
    jellyfin: { server_url: "http://localhost:8096" },
    potplayer: { executable_path: "D:/scoop/apps/potplayer/current/PotPlayerMini64.exe", reg_file: "potplayer.reg" },
  },
  database: {
    path: "D:/video.mkv/.xiranite/jellypot-runs.jsonl",
    enabled: false,
    mode: "jsonl",
    defaultPath: true,
  },
  checks: [
    { name: "potplayer", path: "D:/scoop/apps/potplayer/current/PotPlayerMini64.exe", exists: true },
  ],
  normalizedMediaPath: "D:/video.mkv",
  commands: [
    { label: "launch PotPlayer", command: "D:/scoop/apps/potplayer/current/PotPlayerMini64.exe", args: ["D:/video.mkv"], detached: true },
  ],
  commandResults: [],
  errors: [],
}
