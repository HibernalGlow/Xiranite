import { describe, expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { XlchemyData } from "@xiranite/node-xlchemy/core"

import { Component } from "./Component"
import type { XlchemyCardState } from "./types"

describe("XLchemy EFU browser behavior", () => {
  test("registers an EFU reference without fetching or scanning it", async () => {
    const fetchEfu = vi.fn(async () => new Response("Filename,Size\r\nD:/images/a.png,100"))
    vi.stubGlobal("fetch", fetchEfu)
    const getUrl = vi.fn((path: string) => `local://${path}`)
    const host = createHost(getUrl)
    const view = await render(<div className="h-[900px] w-[1400px]"><Component compId="xlchemy-card" host={host} /></div>)

    await view.getByRole("button", { name: "添加输入" }).click()
    await view.getByRole("menuitem", { name: "导入 EFU 文件列表" }).click()

    await expect.poll(() => host.cardState.efuFiles).toEqual(["D:/Downloads/al.efu"])
    expect(getUrl).not.toHaveBeenCalled()
    expect(fetchEfu).not.toHaveBeenCalled()
    await view.rerender(<div className="h-[900px] w-[1400px]"><Component compId="xlchemy-card" host={host} /></div>)
    await expect.element(view.getByText("al.efu")).toBeVisible()
    await expect.element(view.getByTestId("xlchemy-efu-sources").getByText("流式", { exact: true })).toBeVisible()
    await expect.element(view.getByTestId("xlchemy-header").getByText("1 EFU", { exact: true })).toBeVisible()
  })

  test("leaves the preparing state when a normal file reports conversion progress", async () => {
    const host = createHost((path) => `local://${path}`)
    host.cardState = { pathsText: "D:/images/a.png", format: "AVIF", avifEncoder: "slimg" }
    let finish = () => {}
    const pending = new Promise<void>((resolve) => { finish = resolve })
    host.runner!.run = async <_TInput, TData>(_nodeId: string, _input: _TInput, onEvent?: (event: NodeRunEvent) => void): Promise<NodeRunResult<TData>> => {
      onEvent?.({ type: "progress", progress: 0, message: "Backend accepted xlchemy; loading the node runtime." })
      onEvent?.({ type: "progress", progress: 0, message: "Converting a.png.", data: { kind: "xlchemy-progress-count", completed: 0, total: 1 } })
      await pending
      return {
        success: true,
        message: "Converted.",
        data: { files: [], inputCount: 1, convertedCount: 1, skippedCount: 0, errorCount: 0, inputBytes: 100, outputBytes: 50, errors: [] } as XlchemyData as TData,
      }
    }
    const view = await render(<div className="h-[900px] w-[1400px]"><Component compId="xlchemy-card" host={host} /></div>)

    try {
      await view.getByRole("button", { name: "开始转换" }).click()
      await expect.poll(() => host.cardState.progressText).toBe("Converting a.png.")
      await expect.poll(() => host.cardState.phase).toBe("running")
      expect(host.cardState.processedCount).toBe(0)
      expect(host.cardState.runInputCount).toBe(1)
    } finally {
      finish()
    }
    await expect.poll(() => host.cardState.phase).toBe("completed")
  })
})

type TestHost = NodeHostApi<XlchemyCardState, Partial<XlchemyCardState>> & { cardState: XlchemyCardState }

function createHost(getUrl: (path: string) => string): TestHost {
  const host = {
    cardState: {} as XlchemyCardState,
    contract: { name: "xiranite.node-host", version: "1.0.0", supportedCapabilities: ["state", "runner", "localFiles", "config"], hasCapability: () => true },
    env: { theme: "light", platform: "web" },
    state: {
      getData: () => host.cardState,
      patchData: (patch: Partial<XlchemyCardState>) => { host.cardState = { ...host.cardState, ...patch } },
    },
    runner: {
      run: async <_TInput, TData>(): Promise<NodeRunResult<TData>> => ({
        success: true,
        message: "Planned.",
        data: { files: [], inputCount: 0, convertedCount: 0, skippedCount: 0, errorCount: 0, inputBytes: 0, outputBytes: 0, errors: [] } as XlchemyData as TData,
      }),
    },
    localFiles: {
      getUrl,
      pickFiles: async (options?: { filters?: Array<{ pattern: string }> }) => options?.filters?.[0]?.pattern === "*.efu" ? ["D:/Downloads/al.efu"] : [],
      pickDirectory: async () => undefined,
    },
    clipboard: { readText: async () => "", writeText: async () => undefined },
    config: {
      get: async () => ({ config: undefined, path: "D:/config/xiranite.config.toml" }),
      save: async () => undefined,
      getPresets: async () => ({ presets: [] }),
    },
    getData: <T,>() => host.cardState as T,
    patchData: (_id: string, patch: Partial<XlchemyCardState>) => host.state.patchData(patch),
    listComponents: () => [],
    updateComponent: () => undefined,
  } as unknown as TestHost
  return host
}
