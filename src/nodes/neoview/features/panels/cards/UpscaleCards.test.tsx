import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderSessionDto, ReaderSuperResolutionConfigDto } from "../../../adapters/reader-http-client"
import { setReaderUpscaleArtifact } from "../../reader/ReaderUpscaleArtifactStore"
import UpscaleCacheCard from "./UpscaleCacheCard"
import UpscaleConditionsCard from "./UpscaleConditionsCard"
import UpscaleModelCard from "./UpscaleModelCard"
import UpscaleStatusCard from "./UpscaleStatusCard"

afterEach(cleanup)

describe("NeoView upscale Cards", () => {
  it("[neoview.super-resolution.status-card-idle] keeps a stable snapshot before a Reader session exists", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const { client, ...props } = context()
    render(<UpscaleStatusCard {...props} client={client} session={undefined} />)
    expect(screen.getByText("未超分")).toBeTruthy()
    expect(error).not.toHaveBeenCalledWith(expect.stringContaining("getSnapshot should be cached"))
    error.mockRestore()
  })

  it("[neoview.super-resolution.model-card] persists model controls through the root config callback", async () => {
    const onChange = vi.fn(async () => CONFIG)
    render(<UpscaleModelCard {...context()} onSuperResolutionConfigChange={onChange} />)
    await screen.findByRole("option", { name: /Anime/ })
    fireEvent.change(screen.getByLabelText("默认模型"), { target: { value: "anime" } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ preferences: expect.objectContaining({ defaultModelId: "anime", defaultScale: 2 }) }))
  })

  it("[neoview.super-resolution.model-probe-without-session] probes models before a book is opened", async () => {
    const probe = vi.fn(async () => ({ available: true as const, models: [], engines: [], probedAt: 1 }))
    const { client, ...props } = context({ upscaleCapabilities: probe })
    render(<UpscaleModelCard {...props} client={client} session={undefined} />)
    await waitFor(() => expect(probe).toHaveBeenCalledWith(undefined, false, expect.any(AbortSignal)))
    expect(screen.getByRole("button", { name: "刷新模型" }).hasAttribute("disabled")).toBe(false)
  })

  it("[neoview.super-resolution.managed-daemon-warning] warns when Upscayl falls back to process-per-page mode", async () => {
    const upscaleCapabilities = vi.fn(async () => ({
      available: true as const,
      models: [{ id: "anime", displayName: "Anime", engine: "upscayl" as const, scales: [2], installed: true }],
      engines: [{
        engine: "upscayl" as const,
        available: true,
        managed: false,
        daemonSupported: false,
        performanceMode: "process-per-page" as const,
        warning: "Xiranite managed Upscayl daemon is unavailable. Compatibility mode reloads the model for every page.",
      }],
      probedAt: 1,
    }))
    const { client, ...props } = context({ upscaleCapabilities })
    render(<UpscaleModelCard {...props} client={client} />)
    const warning = await screen.findByRole("alert")
    expect(warning.textContent).toContain("性能降级")
    expect(warning.textContent).toContain("未检测到 Xiranite 托管的 Upscayl daemon")
    expect(warning.textContent).toContain("每页都会重启进程")
  })

  it("[neoview.super-resolution.managed-daemon-missing] reports when no Upscayl executable is usable", async () => {
    const upscaleCapabilities = vi.fn(async () => ({
      available: true as const,
      models: [{ id: "anime", displayName: "Anime", engine: "upscayl" as const, scales: [2], installed: true }],
      engines: [{ engine: "upscayl" as const, available: false, reason: "managed candidate: not found; PATH candidate: invalid" }],
      probedAt: 1,
    }))
    const { client, ...props } = context({ upscaleCapabilities })
    render(<UpscaleModelCard {...props} client={client} />)
    const error = await screen.findByRole("alert")
    expect(error.textContent).toContain("超分引擎不可用")
    expect(error.textContent).toContain("managed candidate: not found")
  })

  it("[neoview.super-resolution.model-sources-card] adds model source directories", async () => {
    const onChange = vi.fn(async () => CONFIG)
    render(<UpscaleModelCard {...context()} onSuperResolutionConfigChange={onChange} />)
    fireEvent.click(await screen.findByRole("button", { name: "展开模型管理" }))
    fireEvent.change(await screen.findByPlaceholderText("添加包含 models 的目录"), { target: { value: "D:/Python/realesrgan" } })
    fireEvent.click(screen.getByRole("button", { name: "添加来源" }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ modelSources: ["D:/Python/realesrgan"] }))
  })

  it("[neoview.super-resolution.model-catalog-filter] hides downloads until model management enables them", async () => {
    render(<UpscaleModelCard {...context()} />)
    await screen.findByRole("option", { name: /Anime/ })
    expect(screen.queryByText("Downloadable Model")).toBeNull()
    expect(screen.queryByLabelText("显示未下载模型")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "展开模型管理" }))
    fireEvent.click(screen.getByLabelText("显示未下载模型"))
    expect(await screen.findByText("Downloadable Model")).toBeTruthy()
  })

  it("[neoview.super-resolution.cache-card] confirms destructive shared cache cleanup", async () => {
    const cleanup = vi.fn(async () => ({ ...CACHE, reason: "explicit" as const, removedEntries: 2, removedBytes: 1024 }))
    const user = userEvent.setup()
    render(<UpscaleCacheCard {...context({ cleanupUpscaleCache: cleanup })} />)
    await screen.findByText("2", { selector: "div" })
    await user.click(screen.getByRole("button", { name: "全部" }))
    await user.click(screen.getByRole("button", { name: "清理" }))
    await waitFor(() => expect(cleanup).toHaveBeenCalledWith("session-1", "all"))
  })

  it("[neoview.super-resolution.conditions-card] edits and persists the complete condition list", async () => {
    const onChange = vi.fn(async () => CONFIG)
    const user = userEvent.setup()
    render(<UpscaleConditionsCard {...context()} onSuperResolutionConfigChange={onChange} />)
    await user.click(screen.getByRole("button", { name: /展开条件编辑器/ }))
    fireEvent.change(screen.getByText("最小宽度").parentElement!.querySelector("input")!, { target: { value: "1280" } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ preferences: expect.objectContaining({ conditions: expect.any(Array) }) })))
    const patch = onChange.mock.calls.at(-1)?.[0]
    expect(patch?.preferences?.conditions?.[0]?.match.minWidth).toBe(1280)
  })

  it("[neoview.super-resolution.conditions-card-models] uses concrete model ids and native scales", async () => {
    const onChange = vi.fn(async () => CONFIG)
    const models = [
      { id: "realesrgan-x4plus-anime", displayName: "Real-ESRGAN 4x Anime", engine: "upscayl" as const, scales: [2, 3, 4], installed: true },
      { id: "realesr-animevideov3", displayName: "RealESR AnimeVideo v3", engine: "upscayl" as const, scales: [2, 4], installed: true },
      { id: "realsr-df2k-x4", displayName: "RealSR DF2K x4", engine: "upscayl" as const, scales: [4], installed: true },
    ]
    const { client, ...props } = context({ upscaleCapabilities: vi.fn(async () => ({ available: true as const, models, engines: [], probedAt: 1 })) })
    render(<UpscaleConditionsCard {...props} client={client} onSuperResolutionConfigChange={onChange} />)
    await userEvent.setup().click(screen.getByRole("button", { name: /展开条件编辑器/ }))
    const modelSelect = screen.getByLabelText("模型") as HTMLSelectElement
    expect(Array.from(modelSelect.options).map((option) => option.value)).toEqual(expect.arrayContaining(["realesrgan-x4plus-anime", "realesr-animevideov3"]))
    expect(Array.from(modelSelect.options).map((option) => option.value)).not.toEqual(expect.arrayContaining(["upscayl", "waifu2x", "realcugan"]))

    fireEvent.change(modelSelect, { target: { value: "realsr-df2k-x4" } })
    const scaleSelect = screen.getByLabelText("输出倍率") as HTMLSelectElement
    expect(Array.from(scaleSelect.options).map((option) => option.value)).toEqual(["4"])
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ preferences: expect.objectContaining({ conditions: [expect.objectContaining({ action: expect.objectContaining({ modelId: "realsr-df2k-x4", scale: 4 }) })] }) }))
  })

  it("[neoview.super-resolution.conditions-import] reads and converts a legacy JSON backup file", async () => {
    const onChange = vi.fn(async () => CONFIG)
    const user = userEvent.setup()
    render(<UpscaleConditionsCard {...context()} onSuperResolutionConfigChange={onChange} />)
    await user.click(screen.getByRole("button", { name: "导入" }))
    const file = new File([JSON.stringify([{
      id: "legacy",
      name: "Legacy",
      enabled: true,
      priority: 8,
      match: { maxPixels: 12.4, dimensionMode: "or" },
      action: { model: "MODEL_REALESRGAN_ANIMAVIDEOV3_UP2X", scale: 2, tileSize: 0, noiseLevel: -1, gpuId: 0, skip: false },
    }])], "condition.json", { type: "application/json" })
    await user.upload(screen.getByLabelText("选择条件 JSON 文件"), file)
    await waitFor(() => expect((screen.getByLabelText("导入条件 JSON") as HTMLTextAreaElement).value).toContain("maxPixels"))
    await user.click(screen.getByRole("button", { name: "应用导入" }))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ preferences: { conditions: [expect.objectContaining({
      id: "legacy",
      priority: 0,
      match: expect.objectContaining({ maxMegapixels: 12.4 }),
      action: expect.objectContaining({ modelId: "realesr-animevideov3", tileSize: undefined, gpuId: "0" }),
    })] } }))
    expect(screen.getByText("已导入 1 条条件。")).toBeTruthy()
  })

  it("[neoview.super-resolution.status-card] renders the artifact state emitted by PageImage without a duplicate upscale request", async () => {
    setReaderUpscaleArtifact("session-1", "page-1", { state: "completed", result: { status: "generated", artifactUrl: "http://reader/upscaled.png", version: "v1" } })
    const client = context().client
    render(<UpscaleStatusCard {...context(client)} />)
    expect(await screen.findByText("已完成")).toBeTruthy()
    expect(screen.getByAltText("超分图").getAttribute("src")).toBe("http://reader/upscaled.png")
    expect(client.upscalePage).not.toHaveBeenCalled()
  })
})

const SESSION: ReaderSessionDto = {
  sessionId: "session-1",
  book: { id: "book-1", displayName: "Book", pageCount: 1 },
  frame: { anchorPageIndex: 0, visiblePageIndexes: [0], generation: 1, pageMode: "single", direction: "ltr", fitMode: "contain", rotation: 0, scale: 1, offset: { x: 0, y: 0 } },
  visiblePages: [{ id: "page-1", index: 0, name: "Page 1", mediaKind: "image", dimensions: { width: 1000, height: 1500 }, contentVersion: "v1", assetUrl: "http://reader/original.png" }],
}
const CONFIG: ReaderSuperResolutionConfigDto = { provider: "opencomic-system", modelsDirectory: "D:/Models", modelSources: [], preferences: { autoUpscaleEnabled: true, showPanelPreview: true, defaultScale: 2, conditions: [{ id: "default", name: "默认条件", enabled: true, priority: 0, match: { dimensionMode: "and" }, action: { skip: false } }] } }
const CACHE = { entries: 2, bytes: 2048, maxBytes: 4096, maxEntryBytes: 2048, activeLeases: 0, hits: 3, misses: 1, writes: 2, rejectedWrites: 0, evictions: 0, integrityFailures: 0 }

function context(overrides: Partial<ReaderHttpClient> | ReaderHttpClient = {}) {
  const client = overrides && "config" in overrides ? overrides as ReaderHttpClient : {
    config: vi.fn(async () => ({ superResolution: CONFIG } as never)),
    upscaleCapabilities: vi.fn(async () => ({ available: true as const, models: [{ id: "anime", displayName: "Anime", engine: "upscayl" as const, scales: [2], family: "RealESRGAN", category: "anime", sizeBytes: 12_582_912, installed: true, sourceDirectories: ["D:/Python/realesrgan"] }, { id: "downloadable", displayName: "Downloadable Model", engine: "upscayl" as const, scales: [4], installed: false }], engines: [], probedAt: 1 })),
    upscaleCache: vi.fn(async () => CACHE),
    cleanupUpscaleCache: vi.fn(async () => ({ ...CACHE, reason: "explicit" as const, removedEntries: 0, removedBytes: 0 })),
    upscalePreloadSnapshots: vi.fn(async () => []),
    upscalePage: vi.fn(),
    ...overrides,
  } as unknown as ReaderHttpClient
  return { client, session: SESSION, disabled: false, superResolution: CONFIG, onGoTo: vi.fn() }
}
