// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { ClassfData, ClassfInput } from "@xiranite/node-classf/core"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import { Component } from "./Component"
import { ACTIONS } from "./constants"
import type { ClassfCardState } from "./types"

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

describe("app-owned classf Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)(
    "renders the %s surface with native ClassF UI",
    (mode) => {
      setSurface(mode)
      render(<Component compId="comp-classf" host={createHost({ pathsText: "D:/set/a.zip" })} />)

      expect(screen.getByText("ClassF")).toBeTruthy()
      if (mode === "collapsed") {
        expect(screen.getByTestId("classf-collapsed-view")).toBeTruthy()
        expect(screen.queryByLabelText("classf paths")).toBeNull()
        return
      }

      expect(screen.getByLabelText("classf paths")).toBeTruthy()
      if (mode === "compact" || mode === "portrait") {
        expect(screen.getAllByRole("tab")).toHaveLength(3)
      }

      if (mode === "compact") {
        expect(screen.getByTestId("classf-compact-view")).toBeTruthy()
      } else if (mode === "portrait") {
        expect(screen.getByTestId("classf-portrait-view")).toBeTruthy()
      } else {
        expect(screen.getByTestId("classf-full-view")).toBeTruthy()
        expect(screen.getByTestId("classf-header-toolbar")).toBeTruthy()
        expect(screen.getByTestId("classf-scan-sources")).toBeTruthy()
        expect(screen.getByTestId("classf-classification-matrix")).toBeTruthy()
        expect(screen.getByRole("button", { name: ACTIONS[0]!.label })).toBeTruthy()
      }
    },
  )

  test("runs plan through host.runner.run and stores classification rows", async () => {
    setSurface("regular")
    const host = createHost({
      action: "plan",
      pathsText: "D:/set/a.zip",
      crashuSourcesText: "D:/library",
      classifyMode: "auto",
      transferMode: "move",
      dryRun: true,
      logs: [],
    })
    render(<Component compId="comp-classf" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: ACTIONS[0]!.label }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "classf",
      input: {
        action: "plan",
        paths: ["D:/set/a.zip"],
        crashuSourcePaths: ["D:/library"],
        targetDir: undefined,
        transferMode: "move",
        classifyMode: "auto",
        existingPolicy: "merge",
        dryRun: true,
      },
    })
    await waitFor(() => expect(host.cardState.phase).toBe("completed"))
    expect(host.cardState.result?.items[0]?.targetRelative).toBe("already/a.zip")
  })

  test("requires confirmation before live classify execution", async () => {
    setSurface("regular")
    const host = createHost({ action: "classify", pathsText: "D:/set/a.zip", crashuSourcesText: "D:/library", dryRun: false, logs: [] })
    render(<Component compId="comp-classf" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: ACTIONS[1]!.label }))
    expect(host.runCalls).toHaveLength(0)

    const dialog = screen.getByRole("alertdialog")
    await user.click(within(dialog).getByRole("button", { name: "Confirm classify" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("classify")
    expect(host.runCalls[0]?.input.dryRun).toBe(false)
  })

  test("allows an empty form so ClassF can use clipboard defaults", async () => {
    setSurface("regular")
    const host = createHost({ action: "plan", logs: [] })
    render(<Component compId="comp-classf" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: ACTIONS[0]!.label }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input).toEqual(expect.objectContaining({ paths: [], crashuSourcePaths: [] }))
    await waitFor(() => expect(host.cardState.phase).toBe("completed"))
  })
})

type TestHost = NodeHostApi<ClassfCardState, Partial<ClassfCardState>> & {
  copiedText: string
  runCalls: Array<{ nodeId: string; input: ClassfInput }>
  savedConfig: Partial<ClassfCardState> | undefined
  cardState: ClassfCardState
}

function createHost(initial: ClassfCardState): TestHost {
  const stateCapability = {
    getData: () => host.cardState,
    patchData: (patch: Partial<ClassfCardState>) => {
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
        host.runCalls.push({ nodeId, input: input as ClassfInput })
        onEvent?.({ type: "progress", progress: 50, message: "Planning classification transfers." })
        return {
          success: true,
          message: "ClassF planned 1 item.",
          data: classfData as TData,
        }
      },
    },
    clipboard: {
      readText: async () => "D:/set/a.zip",
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
    saveNodeConfig: async (config) => { host.savedConfig = config as Partial<ClassfCardState> },
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

const classfData: ClassfData = {
  action: "plan",
  transferMode: "move",
  classifyMode: "auto",
  baseDir: "D:/set",
  items: [
    {
      sourcePath: "D:/set/a.zip",
      targetPath: "D:/set/already/a.zip",
      sourceName: "a.zip",
      targetRelative: "already/a.zip",
      kind: "file",
      stage: "already",
      status: "ready",
    },
  ],
  selectedCount: 1,
  readyCount: 1,
  movedCount: 0,
  copiedCount: 0,
  waitCount: 0,
  conflictCount: 0,
  errorCount: 0,
  errors: [],
}
