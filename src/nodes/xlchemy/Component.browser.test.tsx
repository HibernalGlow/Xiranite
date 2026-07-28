import { describe, expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { XlchemyData } from "@xiranite/node-xlchemy/core"

import { Component } from "./Component"
import type { XlchemyCardState } from "./types"

describe("XLchemy EFU browser behavior", () => {
  test("persists the selected slimg backend", async () => {
    const host = createHost((path) => `local://${path}`)
    host.cardState = { pathsText: "D:/images/a.png", format: "AVIF", avifEncoder: "slimg" }
    const view = await render(<div className="h-[900px] w-[1400px]"><Component compId="xlchemy-card" host={host} /></div>)

    await view.getByRole("tab", { name: "转换", exact: true }).click()
    await view.getByText("DLL（低内存）", { exact: true }).click()
    await view.getByRole("option", { name: "CLI" }).click()

    await expect.poll(() => host.cardState.slimgBackend).toBe("cli")
    await view.rerender(<div className="h-[900px] w-[1400px]"><Component compId="xlchemy-card" host={host} /></div>)
    await expect.poll(() => host.savedConfig?.slimgBackend).toBe("cli")
  })

  test("streams a bounded EFU analysis without loading paths into the table", async () => {
    const fetchEfu = vi.fn(async () => new Response("Filename,Size\r\nD:/images/a.png,100"))
    vi.stubGlobal("fetch", fetchEfu)
    const getUrl = vi.fn((path: string) => `local://${path}`)
    const host = createHost(getUrl)
    const view = await render(<div className="h-[900px] w-[1400px]"><Component compId="xlchemy-card" host={host} /></div>)

    await view.getByRole("button", { name: "添加输入" }).click()
    await view.getByRole("menuitem", { name: "导入 EFU 文件列表" }).click()

    await expect.poll(() => host.cardState.efuFiles).toEqual(["D:/Downloads/al.efu"])
    await expect.poll(() => host.cardState.efuAnalysisByPath?.["D:/Downloads/al.efu"]?.totalFiles).toBe(1)
    expect(getUrl).toHaveBeenCalledWith("D:/Downloads/al.efu")
    expect(fetchEfu).toHaveBeenCalledWith("local://D:/Downloads/al.efu")
    expect(host.cardState.pathsText).toBeUndefined()
    await view.rerender(<div className="h-[900px] w-[1400px]"><Component compId="xlchemy-card" host={host} /></div>)
    await expect.element(view.getByTestId("xlchemy-efu-sources").getByText("al.efu", { exact: true })).toBeVisible()
    await expect.element(view.getByTestId("xlchemy-efu-sources").getByText("流式", { exact: true })).toBeVisible()
    await expect.element(view.getByTestId("xlchemy-header").getByText("1 项 · 1 EFU", { exact: true })).toBeVisible()
    await expect.element(view.getByTestId("xlchemy-data-analysis").getByText("100 B", { exact: true }).first()).toBeVisible()
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

  test("selects dynar as a rename target and submits the animation naming contract", async () => {
    const host = createHost((path) => `local://${path}`)
    host.cardState = { pathsText: "D:/images/motion.gif", format: "JPEG XL" }
    let receivedInput: unknown
    let pickerPattern = ""
    host.localFiles!.pickFiles = async (options) => { pickerPattern = options?.filters?.[0]?.pattern ?? ""; return ["D:/images/motion.gif"] }
    host.localFiles!.list = async (path) => [{ name: "motion.gif", path, isDirectory: false, sizeBytes: 2048, lastModified: 0, type: "image/gif" }]
    host.runner!.run = async <TInput, TData>(_nodeId: string, input: TInput): Promise<NodeRunResult<TData>> => {
      receivedInput = input
      return {
        success: true,
        message: "Renamed.",
        data: { files: [], inputCount: 1, convertedCount: 0, renamedCount: 1, skippedCount: 0, errorCount: 0, inputBytes: 100, outputBytes: 100, errors: [] } as XlchemyData as TData,
      }
    }
    const view = await render(<div className="h-[900px] w-[1400px]"><Component compId="xlchemy-card" host={host} /></div>)

    await view.getByRole("combobox", { name: "目标格式" }).click()
    await view.getByRole("option", { name: "dynar · 重命名" }).click()

    await expect.poll(() => host.cardState.format).toBe("dynar")
    await view.rerender(<div className="h-[900px] w-[1400px]"><Component compId="xlchemy-card" host={host} /></div>)
    await expect.element(view.getByRole("button", { name: "开始重命名" })).toBeVisible()
    await expect.poll(() => host.savedConfig?.filenameRules).toEqual(expect.arrayContaining([expect.objectContaining({ outputFormats: ["dynar"], prefix: "[#dyna]", suffix: ".wbp" })]))

    await expect.element(view.getByTestId("xlchemy-input-workbench").getByText("2.0 KB", { exact: true }).first()).toBeVisible()
    await expect.element(view.getByTestId("xlchemy-data-analysis").getByText("2.0 KB", { exact: true }).first()).toBeVisible()

    await view.getByRole("tab", { name: "转换", exact: true }).click()
    for (const name of ["PNG / APNG", "WebP", "AVIF", "JPEG XL"]) await expect.element(view.getByRole("switch", { name })).toBeVisible()

    await view.getByRole("button", { name: "添加输入" }).click()
    await view.getByRole("menuitem", { name: "添加文件", exact: true }).click()
    await expect.poll(() => pickerPattern).toBe("*.gif;*.webp")

    await view.getByRole("button", { name: "开始重命名" }).click()
    await expect.poll(() => receivedInput).toMatchObject({ format: "dynar", animationDetectionFormats: ["webp"], filenameRules: expect.arrayContaining([expect.objectContaining({ prefix: "[#dyna]" })]) })
  })

  test("keeps a folder as one streaming source and removes selected file and folder roots", async () => {
    const host = createHost((path) => `local://${path}`)
    host.cardState = { format: "dynar", inputViewMode: "list" }
    host.localFiles!.pickFiles = async () => ["D:/images/loose.gif"]
    host.localFiles!.pickDirectory = async () => "D:/images/folder"
    const listFiles = vi.fn(async (path: string) => path === "D:/images/folder"
      ? [{ name: "nested.webp", path: "D:/images/folder/nested.webp", isDirectory: false, sizeBytes: 2048, lastModified: 0, type: "image/webp" }]
      : [{ name: "loose.gif", path, isDirectory: false, sizeBytes: 1024, lastModified: 0, type: "image/gif" }])
    host.localFiles!.list = listFiles
    const view = await render(<div className="h-[900px] w-[1400px]"><Component compId="xlchemy-card" host={host} /></div>)

    await view.getByRole("button", { name: "添加文件", exact: true }).click()
    await expect.poll(() => host.cardState.pathsText).toBe("D:/images/loose.gif")
    await view.rerender(<div className="h-[900px] w-[1400px]"><Component compId="xlchemy-card" host={host} /></div>)

    await view.getByRole("button", { name: "添加输入" }).click()
    await view.getByRole("menuitem", { name: "添加文件夹" }).click()
    await expect.poll(() => host.cardState.pathsText).toBe("D:/images/loose.gif\nD:/images/folder")
    await expect.poll(() => host.cardState.inputDirectoryPaths).toEqual(["D:/images/folder"])
    expect(listFiles).not.toHaveBeenCalledWith("D:/images/folder", expect.anything())
    await view.rerender(<div className="h-[900px] w-[1400px]"><Component compId="xlchemy-card" host={host} /></div>)

    await view.getByRole("checkbox", { name: "选择全部输入" }).click()
    await expect.poll(() => host.cardState.selectedPaths).toEqual(["D:/images/loose.gif", "D:/images/folder"])
    await view.rerender(<div className="h-[900px] w-[1400px]"><Component compId="xlchemy-card" host={host} /></div>)
    await view.getByRole("button", { name: "删除已选" }).click()

    await expect.poll(() => host.cardState.pathsText).toBe("")
    await expect.poll(() => host.cardState.selectedPaths).toEqual([])
    await view.rerender(<div className="h-[900px] w-[1400px]"><Component compId="xlchemy-card" host={host} /></div>)
    await expect.element(view.getByTestId("xlchemy-input-empty")).toBeVisible()
  })

  test("submits a directory root without enumerating it in React", async () => {
    const host = createHost((path) => `local://${path}`)
    host.cardState = { format: "AVIF", avifEncoder: "slimg", inputViewMode: "list" }
    host.localFiles!.pickDirectory = async () => "D:/bulk/200000-images"
    const listFiles = vi.fn(async () => { throw new Error("React must not enumerate a directory source.") })
    host.localFiles!.list = listFiles
    let receivedInput: unknown
    host.runner!.run = async <TInput, TData>(_nodeId: string, input: TInput): Promise<NodeRunResult<TData>> => {
      receivedInput = input
      return { success: true, message: "Planned.", data: { files: [], inputCount: 0, convertedCount: 0, skippedCount: 0, errorCount: 0, inputBytes: 0, outputBytes: 0, errors: [] } as XlchemyData as TData }
    }
    const view = await render(<div className="h-[900px] w-[1400px]"><Component compId="xlchemy-card" host={host} /></div>)

    await view.getByRole("button", { name: "添加输入" }).click()
    await view.getByRole("menuitem", { name: "添加文件夹" }).click()
    await expect.poll(() => host.cardState.pathsText).toBe("D:/bulk/200000-images")
    await expect.poll(() => host.cardState.inputDirectoryPaths).toEqual(["D:/bulk/200000-images"])
    expect(listFiles).not.toHaveBeenCalled()

    await view.rerender(<div className="h-[900px] w-[1400px]"><Component compId="xlchemy-card" host={host} /></div>)
    await expect.element(view.getByText("目录源 · 后端流式扫描", { exact: true })).toBeVisible()
    await view.getByRole("button", { name: "预览计划" }).click()
    await expect.poll(() => receivedInput).toMatchObject({ action: "plan", paths: ["D:/bulk/200000-images"] })
    expect(listFiles).not.toHaveBeenCalled()
  })
})

type TestHost = NodeHostApi<XlchemyCardState, Partial<XlchemyCardState>> & { cardState: XlchemyCardState; savedConfig?: Partial<XlchemyCardState> }

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
      save: async (config: Partial<XlchemyCardState>) => { host.savedConfig = config },
      getPresets: async () => ({ presets: [] }),
    },
    getData: <T,>() => host.cardState as T,
    patchData: (_id: string, patch: Partial<XlchemyCardState>) => host.state.patchData(patch),
    listComponents: () => [],
    updateComponent: () => undefined,
  } as unknown as TestHost
  return host
}
