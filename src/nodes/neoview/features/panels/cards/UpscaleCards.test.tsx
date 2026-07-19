import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderSessionDto, ReaderSuperResolutionConfigDto } from "../../../adapters/reader-http-client"
import { setReaderUpscaleArtifact } from "../../reader/ReaderUpscaleArtifactStore"
import UpscaleCacheCard from "./UpscaleCacheCard"
import UpscaleConditionsCard from "./UpscaleConditionsCard"
import UpscaleModelCard from "./UpscaleModelCard"
import UpscaleStatusCard from "./UpscaleStatusCard"

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
    await screen.findByRole("option", { name: "Anime" })
    fireEvent.change(screen.getByLabelText("模型"), { target: { value: "anime" } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ preferences: { defaultModelId: "anime" } }))
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
const CONFIG: ReaderSuperResolutionConfigDto = { provider: "opencomic-system", modelsDirectory: "D:/Models", preferences: { autoUpscaleEnabled: true, showPanelPreview: true, defaultScale: 2, conditions: [{ id: "default", name: "默认条件", enabled: true, priority: 0, match: { dimensionMode: "and" }, action: { skip: false } }] } }
const CACHE = { entries: 2, bytes: 2048, maxBytes: 4096, maxEntryBytes: 2048, activeLeases: 0, hits: 3, misses: 1, writes: 2, rejectedWrites: 0, evictions: 0, integrityFailures: 0 }

function context(overrides: Partial<ReaderHttpClient> | ReaderHttpClient = {}) {
  const client = overrides && "config" in overrides ? overrides as ReaderHttpClient : {
    config: vi.fn(async () => ({ superResolution: CONFIG } as never)),
    upscaleCapabilities: vi.fn(async () => ({ available: true as const, models: [{ id: "anime", displayName: "Anime", engine: "upscayl" as const, scales: [2] }], engines: [], probedAt: 1 })),
    upscaleCache: vi.fn(async () => CACHE),
    cleanupUpscaleCache: vi.fn(async () => ({ ...CACHE, reason: "explicit" as const, removedEntries: 0, removedBytes: 0 })),
    upscalePreloadSnapshots: vi.fn(async () => []),
    upscalePage: vi.fn(),
    ...overrides,
  } as unknown as ReaderHttpClient
  return { client, session: SESSION, disabled: false, superResolution: CONFIG, onGoTo: vi.fn() }
}
