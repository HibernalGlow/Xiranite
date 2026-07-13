// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import type { LoratData, LoratInput, LoratRow } from "@xiranite/node-lorat/core"
import { Component } from "./Component"
import type { LoratCardState } from "./types"

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

describe("app-owned lorat Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)(
    "renders the %s surface with Lorat-specific UI",
    (mode) => {
      setSurface(mode)
      render(<Component compId="comp-lorat" host={createHost({ folderPath: "D:/ComfyUI/models/loras" })} />)

      expect(screen.getByText("Lorat")).toBeTruthy()
      if (mode === "collapsed") {
        expect(screen.getByTestId("lorat-collapsed-view")).toBeTruthy()
        expect(screen.getByText(/D:\/ComfyUI\/models\/loras 等待扫描/)).toBeTruthy()
        expect(screen.queryByLabelText("lorat LoRA 目录")).toBeNull()
        return
      }

      expect(screen.getByLabelText("lorat LoRA 目录")).toBeTruthy()
      expect(screen.getByTestId("lorat-action-picker")).toBeTruthy()
      expect(screen.getByRole("tab", { name: "模型" })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "日志" })).toBeTruthy()

      if (mode === "compact") {
        expect(screen.getByTestId("lorat-compact-view")).toBeTruthy()
        expect(screen.getByRole("button", { name: "lorat 高级选项" })).toBeTruthy()
      } else if (mode === "portrait") {
        expect(screen.getByTestId("lorat-portrait-view")).toBeTruthy()
        expect(screen.getByLabelText("lorat 搜索过滤")).toBeTruthy()
      } else {
        expect(screen.getByTestId("lorat-full-view")).toBeTruthy()
        expect(screen.getAllByText("TriggerDB JSON").length).toBeGreaterThanOrEqual(1)
        expect(screen.getByText("任务")).toBeTruthy()
        expect(screen.getByTestId("lorat-header-toolbar")).toBeTruthy()
      }
    },
  )

  test("forces collapsed content when compact surface height is too short", () => {
    setSurfaceSize({ width: 420, height: 159 })

    render(<Component compId="comp-lorat" host={createHost({ folderPath: "D:/ComfyUI/models/loras" })} />)

    expect(screen.getByTestId("lorat-collapsed-view")).toBeTruthy()
    expect(screen.queryByLabelText("lorat LoRA 目录")).toBeNull()
  })

  test("uses portrait compact layout for tall compact surfaces", () => {
    setSurfaceSize({ width: 559, height: 300 })

    render(<Component compId="comp-lorat" host={createHost({ folderPath: "D:/ComfyUI/models/loras" })} />)

    expect(screen.getByTestId("lorat-portrait-view")).toBeTruthy()
    expect(screen.queryByTestId("lorat-compact-view")).toBeNull()
  })

  test("pastes a folder path from the clipboard", async () => {
    setSurface("compact")
    const host = createHost({})
    render(<Component compId="comp-lorat" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "粘贴目录" }))

    expect(host.state.folderPath).toBe("D:/ComfyUI/models/loras")
  })

  test("runs apply_db locally when triggerDbJson is provided without calling host.actions.run", async () => {
    setSurface("regular")
    const host = createHost({
      action: "apply_db",
      triggerDbJson: SAMPLE_DB_JSON,
      rows: [SAMPLE_ROW],
      logs: [],
    })
    render(<Component compId="comp-lorat" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "运行应用" }))

    expect(host.runCalls).toHaveLength(0)
    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.rows?.[0]?.dbKey).toBeTruthy()
    expect(host.state.logs?.at(-1)).toBe("Applied TriggerDB to 1 row(s).")
  })

  test("requires AlertDialog confirmation before executing the destructive write_triggers action", async () => {
    setSurface("regular")
    const host = createHost({
      action: "write_triggers",
      rows: [{ ...SAMPLE_ROW, selected: true }],
      logs: [],
    })
    render(<Component compId="comp-lorat" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "运行写入" }))
    expect(host.runCalls).toHaveLength(0)

    expect(screen.getByText("确认真实执行 Lorat？")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "确认执行" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("write_triggers")
    await waitFor(() => expect(host.state.phase).toBe("completed"))
  })

  test("marks the card as error when the runner returns a failed response", async () => {
    setSurface("regular")
    const host = createHost(
      { folderPath: "D:/ComfyUI/models/loras", action: "scan", logs: [] },
      { runResult: { success: false, message: "Scan failed: permission denied.", data: { ...loratData, errors: ["Scan failed: permission denied."] } } },
    )
    render(<Component compId="comp-lorat" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "运行扫描" }))

    await waitFor(() => expect(host.state.phase).toBe("error"))
    expect(host.state.progressText).toBe("Scan failed: permission denied.")
    expect(host.state.logs?.at(-1)).toBe("Scan failed: permission denied.")
  })

  test("saves, restores, and clears default config controls", async () => {
    setSurface("regular")
    const host = createHost(
      { folderPath: "D:/current", action: "scan", search: "alice" },
      { config: { folderPath: "D:/default", action: "apply_db", search: "" } },
    )
    render(<Component compId="comp-lorat" host={host} />)
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByRole("button", { name: "配置管理" }).className).toContain("bg-secondary"))
    await user.click(screen.getByRole("button", { name: "配置管理" }))
    await user.click(screen.getByRole("button", { name: "恢复默认" }))
    expect(host.state.folderPath).toBe("D:/default")
    expect(host.state.action).toBe("apply_db")
    expect(host.state.search).toBe("")

    await user.click(screen.getByRole("button", { name: "保存为默认" }))
    expect(host.savedConfig).toBeDefined()
  })

  test("queues a desktop-dropped LoRA in the collection tab and sends a collect request", async () => {
    setSurface("regular")
    const host = createHost({ collectionRoot: "D:/ComfyUI/models/loras" })
    render(<Component compId="comp-lorat" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("tab", { name: "收集" }))
    const model = new File(["model"], "neon_mecha.safetensors") as File & { path?: string }
    Object.defineProperty(model, "path", { value: "D:/Downloads/neon_mecha.safetensors" })
    fireEvent.drop(screen.getByTestId("lorat-collection-model-drop"), { dataTransfer: { files: [model] } })

    expect(screen.getByText("neon_mecha.safetensors")).toBeTruthy()
    expect(host.state.collectionItems?.[0]).toMatchObject({
      sourcePath: "D:/Downloads/neon_mecha.safetensors",
      targetRelativeDir: "uncategorized/neon-mecha",
    })

    await user.click(screen.getByRole("button", { name: "收集到 LoRA 库" }))
    await user.click(screen.getByRole("button", { name: "确认收集" }))
    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input).toMatchObject({
      action: "collect",
      collectionRoot: "D:/ComfyUI/models/loras",
      collectionItems: [{ sourcePath: "D:/Downloads/neon_mecha.safetensors" }],
    })
  })

  test("routes a native desktop drop through the shared local-files capability", async () => {
    setSurface("regular")
    const handlers = new Map<string, (paths: string[]) => void>()
    const host = createHost({ collectionRoot: "D:/ComfyUI/models/loras" })
    host.localFiles = {
      getUrl: (path) => `local://${path}`,
      subscribeDrops: async (targetId, handler) => {
        handlers.set(targetId, handler)
        return () => handlers.delete(targetId)
      },
    }
    render(<Component compId="comp-lorat" host={host} />)
    await userEvent.setup().click(screen.getByRole("tab", { name: "收集" }))
    const target = screen.getByTestId("lorat-collection-model-drop")
    await waitFor(() => expect(handlers.has(target.id)).toBe(true))

    handlers.get(target.id)?.(["D:/Downloads/native_style.safetensors"])

    await waitFor(() => expect(screen.getByText("native_style.safetensors")).toBeTruthy())
    expect(host.state.collectionItems?.[0]?.sourcePath).toBe("D:/Downloads/native_style.safetensors")
  })

  test("toggles row selection and edits trigger", async () => {
    setSurface("regular")
    const host = createHost({ rows: [SAMPLE_ROW], logs: [] })
    render(<Component compId="comp-lorat" host={host} />)

    const checkbox = screen.getByRole("checkbox", { name: "选择 alice_v1.safetensors" })
    fireEvent.mouseDown(checkbox)
    expect(host.state.rows?.[0]?.selected).toBe(true)

    const triggerInput = screen.getByLabelText("触发词 alice_v1.safetensors")
    fireEvent.change(triggerInput, { target: { value: "alice, blonde hair" } })
    expect(host.state.rows?.[0]?.trigger).toBe("alice, blonde hair")
    expect(host.state.rows?.[0]?.changed).toBe(true)
  })

  test("renders Dice data table filtering controls for Lorat rows", () => {
    setSurface("regular")
    const host = createHost({
      rows: [
        SAMPLE_ROW,
        { ...SAMPLE_ROW, key: "artist/bella", name: "bella_v2.safetensors", status: "trigger", source: "sidecar", trigger: "bella" },
      ],
      logs: [],
    })
    render(<Component compId="comp-lorat" host={host} />)

    expect(screen.getByTestId("lorat-data-table")).toBeTruthy()
    expect(screen.getByPlaceholderText("Filter models...")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Filter Status" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Filter Source" })).toBeTruthy()
    expect(screen.getByText("View")).toBeTruthy()
  })

  test("requires confirmation before row-level mark_no_trigger action", async () => {
    setSurface("regular")
    const host = createHost({ rows: [SAMPLE_ROW], logs: [] })
    render(<Component compId="comp-lorat" host={host} />)
    const user = userEvent.setup()

    fireEvent.mouseDown(screen.getByRole("button", { name: "标记无触发词 alice_v1.safetensors" }))
    expect(host.runCalls).toHaveLength(0)

    expect(screen.getByText("确认标记无触发词？")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "确认执行" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("mark_no_trigger")
    expect(host.runCalls[0]?.input.selectedKeys).toEqual([SAMPLE_ROW.key])
  })
})

type TestHost = NodeHostApi & {
  copiedText: string
  openConfigFileCalls: number
  runCalls: Array<{ nodeId: string; input: LoratInput }>
  savedConfig: Partial<LoratCardState> | undefined
  state: LoratCardState
}

type HostOptions = {
  config?: Partial<LoratCardState>
  runResult?: NodeRunResult<LoratData>
}

function createHost(initial: LoratCardState, options: HostOptions = {}): TestHost {
  const host: TestHost = {
    state: { ...initial },
    runCalls: [],
    copiedText: "",
    savedConfig: undefined,
    openConfigFileCalls: 0,
    getData: <T,>() => host.state as T,
    patchData: (_compId, patch) => {
      host.state = { ...host.state, ...patch }
    },
    listComponents: () => [],
    updateComponent: () => undefined,
    actions: {
      run: async <TInput, TData>(
        nodeId: string,
        input: TInput,
        onEvent?: (event: NodeRunEvent) => void,
      ): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as LoratInput })
        onEvent?.({ type: "progress", progress: 25, message: "Scanning 1/1: alice_v1.safetensors" })
        onEvent?.({ type: "log", message: "Found 1 LoRA model(s)." })
        onEvent?.({ type: "progress", progress: 100, message: "lorat complete." })
        return (options.runResult ?? {
          success: true,
          message: "Found 1 LoRA model(s).",
          data: loratData,
        }) as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/ComfyUI/models/loras",
      writeText: async (text) => {
        host.copiedText = text
      },
    },
    env: {
      theme: "light",
      platform: "web",
    },
    getNodeConfig: async <T,>() => ({ config: options.config as T | undefined, path: "D:/config/xiranite.config.toml" }),
    saveNodeConfig: async (config) => {
      host.savedConfig = config as Partial<LoratCardState>
    },
    openConfigFile: () => {
      host.openConfigFileCalls += 1
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

const SAMPLE_ROW: LoratRow = {
  key: "artist/alice",
  name: "alice_v1.safetensors",
  stem: "alice_v1",
  filePath: "D:\\ComfyUI\\models\\loras\\artist\\alice_v1.safetensors",
  relativeDir: "artist",
  relativePath: "artist/alice_v1.safetensors",
  pathParts: ["loras", "artist", "alice_v1.safetensors"],
  status: "missing",
  originalStatus: "missing",
  trigger: "alice",
  originalTrigger: "alice",
  source: "filename",
  dbKey: "",
  changed: false,
  selected: false,
}

const SAMPLE_DB_JSON = JSON.stringify({
  "artist/alice": {
    all_triggers: "alice, blonde hair",
    active_triggers: "alice, blonde hair",
  },
}, null, 2)

const loratData: LoratData = {
  folderPath: "D:/ComfyUI/models/loras",
  rows: [SAMPLE_ROW],
  stats: {
    total: 1,
    missing: 1,
    trigger: 0,
    notrigger: 0,
    changed: 0,
    selected: 0,
    dbMatched: 0,
  },
  triggerDbJson: "",
  writtenCount: 0,
  skippedCount: 0,
  errors: [],
  collection: [],
}
