// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import type { RecycleuData, RecycleuInput } from "@xiranite/node-recycleu/core"
import { Component } from "./Component"
import type { RecycleuCardState } from "./types"

const surfaceState = vi.hoisted(() => ({
  mode: "regular" as NodeSurfaceMode,
  height: undefined as number | undefined,
}))

vi.mock("@/nodes/shared/useNodeSurface", () => ({
  useNodeSurface: () => ({
    ref: { current: null },
    width: widthForMode(surfaceState.mode),
    height: surfaceState.height ?? heightForMode(surfaceState.mode),
    mode: surfaceState.mode,
    density: surfaceState.mode === "collapsed" || surfaceState.mode === "compact" ? "tight" : "roomy",
  }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  surfaceState.mode = "regular"
  surfaceState.height = undefined
})

describe("app-owned recycleu Component", () => {
  test.each(["collapsed", "compact", "regular", "expanded", "workspace"] as NodeSurfaceMode[])(
    "renders the %s surface with complete cleanup affordances",
    async (mode) => {
      surfaceState.mode = mode
      render(<Component compId="comp-recycleu" host={createHost({ interval: 10, maxCycles: 2, driveLetter: "C" })} />)
      const user = userEvent.setup()

      expect(screen.getByText("Recycleu")).toBeTruthy()
      expect(screen.getAllByText(/就绪/).length).toBeGreaterThan(0)

      if (mode === "collapsed") {
        expect(screen.queryByLabelText("清理间隔秒数")).toBeNull()
        await user.click(screen.getByRole("button", { name: "操作和参数" }))
        expect(screen.getByLabelText("清理间隔秒数")).toBeTruthy()
        expect(screen.getByRole("button", { name: "启动" })).toBeTruthy()
        expect(screen.getByRole("button", { name: "立即清理" })).toBeTruthy()
        expect(screen.getByRole("button", { name: "状态" })).toBeTruthy()
        return
      }

      expect(screen.getByLabelText("清理间隔秒数")).toBeTruthy()
      expect(screen.getByLabelText("最大循环次数")).toBeTruthy()
      expect(screen.getByLabelText("盘符")).toBeTruthy()
      expect(screen.getByRole("button", { name: "启动" })).toBeTruthy()
      expect(screen.getByRole("button", { name: "立即清理" })).toBeTruthy()
      expect(screen.getByRole("button", { name: "状态" })).toBeTruthy()
    },
  )

  test("keeps compact actions usable when the card is short", async () => {
    surfaceState.mode = "compact"
    surfaceState.height = 260
    render(<Component compId="comp-recycleu" host={createHost({ interval: 10, maxCycles: 2, driveLetter: "C" })} />)
    const user = userEvent.setup()

    expect(screen.getByText("Recycleu")).toBeTruthy()
    expect(screen.queryByLabelText("清理间隔秒数")).toBeNull()
    expect(screen.getByRole("button", { name: "启动" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "立即清理" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "状态" })).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "操作和参数" }))
    expect(screen.getByLabelText("清理间隔秒数")).toBeTruthy()
    expect(screen.getByLabelText("最大循环次数")).toBeTruthy()
    expect(screen.getByLabelText("盘符")).toBeTruthy()
  })

  test("falls back to a collapsed summary when compact height is extremely short", async () => {
    surfaceState.mode = "compact"
    surfaceState.height = 140
    render(<Component compId="comp-recycleu" host={createHost({ interval: 10, maxCycles: 2, driveLetter: "C" })} />)
    const user = userEvent.setup()

    expect(screen.getByText("Recycleu")).toBeTruthy()
    expect(screen.getByText(/C: · 10s · 2 次/)).toBeTruthy()
    expect(screen.queryByLabelText("清理间隔秒数")).toBeNull()

    await user.click(screen.getByRole("button", { name: "操作和参数" }))
    expect(screen.getByLabelText("清理间隔秒数")).toBeTruthy()
    expect(screen.getByRole("button", { name: "启动" })).toBeTruthy()
  })

  test("renders logs below controls in narrow regular cards", () => {
    surfaceState.mode = "regular"
    surfaceState.height = 610
    render(<Component compId="comp-recycleu" host={createHost({ interval: 10, maxCycles: 2, driveLetter: "C" })} />)

    expect(screen.getByText("清理控制")).toBeTruthy()
    expect(screen.getByText("运行日志")).toBeTruthy()
    expect(screen.getByLabelText("清理间隔秒数")).toBeTruthy()
    expect(screen.getByRole("button", { name: "启动" })).toBeTruthy()
  })

  test("moves logs below controls in tall compact portrait cards", () => {
    surfaceState.mode = "compact"
    surfaceState.height = 520
    render(<Component compId="comp-recycleu" host={createHost({ interval: 10, maxCycles: 2, driveLetter: "C" })} />)

    expect(screen.getByText("运行日志")).toBeTruthy()
    expect(screen.getByLabelText("清理间隔秒数")).toBeTruthy()
    expect(screen.getByRole("button", { name: "启动" })).toBeTruthy()
    expect(screen.getByText(/暂无日志/)).toBeTruthy()
  })

  test("requires confirmation before emptying the recycle bin", async () => {
    surfaceState.mode = "compact"
    const host = createHost({ interval: 10, maxCycles: 1, driveLetter: "C" })
    render(<Component compId="comp-recycleu" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "立即清理" }))
    expect(host.runCalls).toHaveLength(0)

    await user.click(screen.getByRole("button", { name: "确认清理" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "recycleu",
      input: {
        action: "clean_now",
        interval: 10,
        maxCycles: 1,
        driveLetter: "C",
      },
    })
    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.cleanCount).toBe(1)
    expect(host.state.logs).toContain("Recycle bin emptied for drive C:.")
  })

  test("updates countdown and logs while an auto-clean run is pending", async () => {
    surfaceState.mode = "regular"
    const deferred = createDeferred<NodeRunResult<RecycleuData>>()
    const host = createHost({ interval: 10, maxCycles: 2 }, { pending: deferred.promise })
    render(<Component compId="comp-recycleu" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "启动" }))
    await user.click(screen.getByRole("button", { name: "确认启动" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.action).toBe("start")
    await waitFor(() => expect(host.state.remainingSeconds).toBe(5))
    expect(host.state.progress).toBe(40)
    expect(host.state.logs).toContain("cleaned 1 time(s), next clean in 5s")

    deferred.resolve(successResult("Auto-clean completed, cleaned 1 time(s)."))

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.progress).toBe(100)
    expect(host.state.logs).toContain("Auto-clean completed, cleaned 1 time(s).")
  })

  test("persists backend failures as visible node state", async () => {
    surfaceState.mode = "regular"
    const host = createHost({ interval: 10, maxCycles: 1 }, { fail: true })
    render(<Component compId="comp-recycleu" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "状态" }))

    await waitFor(() => expect(host.state.phase).toBe("error"))
    expect(host.state.progressText).toBe("Failed to empty recycle bin.")
    expect(host.state.logs).toContain("Failed to empty recycle bin.")
    expect(screen.getAllByText("失败").length).toBeGreaterThan(0)
  })

  test("reports missing backend instead of silently doing nothing", async () => {
    surfaceState.mode = "regular"
    const host = createHost({ interval: 10, maxCycles: 1 }, { noBackend: true })
    render(<Component compId="comp-recycleu" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "状态" }))

    await waitFor(() => expect(host.state.phase).toBe("error"))
    expect(host.state.logs).toContain("Local Backend 暂不可用，无法执行 recycleu。")
  })
})

type TestHost = NodeHostApi & {
  state: RecycleuCardState
  runCalls: Array<{ nodeId: string; input: RecycleuInput }>
  copiedText: string
}

function createHost(
  initial: RecycleuCardState,
  options: { fail?: boolean; noBackend?: boolean; pending?: Promise<NodeRunResult<RecycleuData>> } = {},
): TestHost {
  const host: TestHost = {
    state: { ...initial },
    runCalls: [],
    copiedText: "",
    getData: <T,>() => host.state as T,
    patchData: (_compId, patch) => {
      host.state = { ...host.state, ...patch }
    },
    listComponents: () => [],
    updateComponent: () => undefined,
    clipboard: {
      readText: async () => "",
      writeText: async (text) => {
        host.copiedText = text
      },
    },
    env: {
      theme: "light",
      platform: "web",
    },
  }

  if (!options.noBackend) {
    host.actions = {
      run: async <TInput, TData>(nodeId: string, input: TInput, onEvent?: (event: NodeRunEvent) => void): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as RecycleuInput })
        onEvent?.({ type: "progress", progress: 40, message: "cleaned 1 time(s), next clean in 5s" })
        if (options.pending) return await options.pending as NodeRunResult<TData>
        if (options.fail) {
          return {
            success: false,
            message: "Failed to empty recycle bin.",
            data: {
              timerStatus: "error",
              cleanCount: 0,
              lastCleanTime: null,
              remainingSeconds: 0,
            },
          } as NodeRunResult<TData>
        }
        return successResult("Recycle bin emptied for drive C:.") as NodeRunResult<TData>
      },
    }
  }

  return host
}

function successResult(message: string): NodeRunResult<RecycleuData> {
  return {
    success: true,
    message,
    data: {
      timerStatus: "completed",
      cleanCount: 1,
      lastCleanTime: "01:02:03",
      remainingSeconds: 0,
    },
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function widthForMode(mode: NodeSurfaceMode): number {
  if (mode === "collapsed") return 240
  if (mode === "compact") return 420
  if (mode === "regular") return 720
  if (mode === "expanded") return 920
  return 1120
}

function heightForMode(mode: NodeSurfaceMode): number {
  if (mode === "collapsed") return 120
  if (mode === "compact") return 300
  if (mode === "regular") return 420
  if (mode === "expanded") return 560
  return 720
}
