// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { SynctData, SynctInput } from "@xiranite/node-synct/core"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import { Component } from "./Component"
import { ACTIONS } from "./constants"
import type { SynctCardState } from "./types"

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

describe("app-owned synct Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)(
    "renders the %s surface with native Synct UI",
    (mode) => {
      setSurface(mode)
      render(<Component compId="comp-synct" host={createHost({ pathsText: "D:/downloads" })} />)

      expect(screen.getByText("Synct")).toBeTruthy()

      if (mode === "collapsed") {
        expect(screen.getByTestId("synct-collapsed-view")).toBeTruthy()
        expect(screen.queryByLabelText("synct paths")).toBeNull()
        return
      }

      expect(screen.getByLabelText("synct paths")).toBeTruthy()
      expect(screen.getAllByRole("tab")).toHaveLength(3)

      if (mode === "compact") {
        expect(screen.getByTestId("synct-compact-view")).toBeTruthy()
      } else if (mode === "portrait") {
        expect(screen.getByTestId("synct-portrait-view")).toBeTruthy()
      } else {
        expect(screen.getByTestId("synct-full-view")).toBeTruthy()
        expect(screen.getByTestId("synct-header-toolbar")).toBeTruthy()
        expect(screen.getByText("Sources and format")).toBeTruthy()
        expect(screen.getByText("Archive path plan")).toBeTruthy()
        expect(screen.getByRole("button", { name: ACTIONS[1]!.label })).toBeTruthy()
      }
    },
  )

  test("runs plan through host.runner.run and stores archive rows", async () => {
    setSurface("regular")
    const host = createHost({
      action: "plan",
      pathsText: "D:/downloads",
      sourceMode: "files",
      formatKey: "year_month",
      dryRun: true,
      logs: [],
    })
    render(<Component compId="comp-synct" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: ACTIONS[1]!.label }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "synct",
      input: {
        action: "plan",
        paths: ["D:/downloads"],
        sourceMode: "files",
        formatKey: "year_month",
        recursive: false,
        archiveFolder: false,
        fallbackToCreatedTime: true,
        syncFolderFileTimes: true,
        dryRun: true,
      },
    })
    await waitFor(() => expect(host.cardState.phase).toBe("completed"))
    expect(host.cardState.result?.items[0]?.targetRelative).toBe("2026-07/photo_2026-07-10.jpg")
  })

  test("requires confirmation before live archive execution", async () => {
    setSurface("regular")
    const host = createHost({ action: "archive", pathsText: "D:/downloads", dryRun: false, logs: [] })
    render(<Component compId="comp-synct" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: ACTIONS[2]!.label }))
    expect(host.runCalls).toHaveLength(0)

    const dialog = screen.getByRole("alertdialog")
    await user.click(within(dialog).getByRole("button", { name: "Confirm archive" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("archive")
    expect(host.runCalls[0]?.input.dryRun).toBe(false)
  })

  test("marks the card as error when run has no paths", async () => {
    setSurface("regular")
    const host = createHost({ action: "plan", logs: [] })
    render(<Component compId="comp-synct" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: ACTIONS[1]!.label }))

    expect(host.runCalls).toHaveLength(0)
    await waitFor(() => expect(host.cardState.phase).toBe("error"))
    expect(host.cardState.progressText).toContain("source path")
  })
})

type TestHost = NodeHostApi<SynctCardState, Partial<SynctCardState>> & {
  copiedText: string
  runCalls: Array<{ nodeId: string; input: SynctInput }>
  savedConfig: Partial<SynctCardState> | undefined
  cardState: SynctCardState
}

function createHost(initial: SynctCardState): TestHost {
  const stateCapability = {
    getData: () => host.cardState,
    patchData: (patch: Partial<SynctCardState>) => {
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
        host.runCalls.push({ nodeId, input: input as SynctInput })
        onEvent?.({ type: "progress", progress: 50, message: "Planning timestamp archive rows." })
        return {
          success: true,
          message: "Synct planned 1 item.",
          data: synctData as TData,
        }
      },
    },
    clipboard: {
      readText: async () => "D:/downloads",
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
    saveNodeConfig: async (config) => { host.savedConfig = config as Partial<SynctCardState> },
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

const synctData: SynctData = {
  action: "plan",
  sourceMode: "files",
  formatKey: "year_month",
  items: [
    {
      sourcePath: "D:/downloads/photo_2026-07-10.jpg",
      targetPath: "D:/downloads/2026-07/photo_2026-07-10.jpg",
      sourceName: "photo_2026-07-10.jpg",
      targetRelative: "2026-07/photo_2026-07-10.jpg",
      kind: "file",
      timestamp: "2026-07-10T00:00:00.000Z",
      status: "ready",
    },
  ],
  scannedCount: 1,
  readyCount: 1,
  movedCount: 0,
  skippedCount: 0,
  conflictCount: 0,
  errorCount: 0,
  errors: [],
}
