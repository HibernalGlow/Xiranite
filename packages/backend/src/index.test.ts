import { describe, expect, test, vi } from "vitest"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"
import { ResourceSchedulerService } from "@xiranite/services"
import type { NodeRunEventDTO } from "@xiranite/shared"
import { createDefaultBackend, createDefaultBackendApp, parseBackendCliArgs, resolveBackendDatabaseConfig, resolveBackendDataDir, startBackend } from "./index.js"

const RUN_ROOT = join(process.cwd(), "../../artifacts/test-runs/backend")
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
)
const TINY_FLAC_HEADER = Buffer.from("fLaC00000000", "utf8")

describe("backend", () => {
  test("serves workspace list through the Elysia app", async () => {
    const app = await createDefaultBackendApp({ now: 100, repository: createMemoryWorkspaceRepository() })
    const response = await app.handle(new Request("http://localhost/workspace"))
    const body = await response.json() as {
      workspaces: Array<{ id: string; label: string; createdAt: number; updatedAt: number }>
    }

    expect(response.status).toBe(200)
    expect(body.workspaces).toEqual([{ id: "ws-default", label: "Default", createdAt: 100, updatedAt: 100 }])
  })

  test("manages node presets through database-backed config routes", async () => {
    const dataDir = await createTempDataDir()
    try {
      const app = await createDefaultBackendApp({
        now: 100,
        repository: createMemoryWorkspaceRepository(),
        configPath: join(dataDir, "xiranite.config.toml"),
      })
      const createdResponse = await app.handle(new Request("http://localhost/config/nodes/xlchemy/presets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Archive", values: { format: "WebP", quality: 77 } }),
      }))
      const created = await createdResponse.json() as { preset: { id: string; name: string; values: Record<string, unknown> } }
      const updatedResponse = await app.handle(new Request(`http://localhost/config/nodes/xlchemy/presets/${created.preset.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Archive v2", values: { format: "JPEG XL", quality: 91 } }),
      }))
      const listedResponse = await app.handle(new Request("http://localhost/config/nodes/xlchemy/presets"))
      const listed = await listedResponse.json() as { presets: Array<{ id: string; name: string; values: Record<string, unknown> }> }
      const deletedResponse = await app.handle(new Request(`http://localhost/config/nodes/xlchemy/presets/${created.preset.id}`, { method: "DELETE" }))

      expect(createdResponse.status).toBe(200)
      expect(updatedResponse.status).toBe(200)
      expect(listedResponse.status).toBe(200)
      expect(listed.presets).toEqual([{ id: created.preset.id, name: "Archive v2", values: { format: "JPEG XL", quality: 91 } }])
      expect(await deletedResponse.json()).toEqual({ deleted: true })
    } finally {
      await removeWithWindowsRetry(dataDir)
    }
  })

  test("serves and persists workspace snapshots", async () => {
    const app = await createDefaultBackendApp({ now: 100, repository: createMemoryWorkspaceRepository() })
    const load = await app.handle(new Request("http://localhost/workspace/snapshot"))
    const snapshot = await load.json() as { snapshot: { workspaces: unknown[]; lanes: unknown[]; components: unknown[] } }

    expect(load.status).toBe(200)
    expect(snapshot.snapshot.workspaces).toHaveLength(1)

    const save = await app.handle(new Request("http://localhost/workspace/snapshot", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaces: [], lanes: [], components: [] }),
    }))
    const saved = await save.json() as { snapshot: { workspaces: unknown[]; lanes: unknown[]; components: unknown[] } }

    expect(save.status).toBe(200)
    expect(saved.snapshot.workspaces).toHaveLength(0)
  })

  test("runs nodes through the injected local runner service", async () => {
    const app = await createDefaultBackendApp({
      now: 100,
      repository: createMemoryWorkspaceRepository(),
      nodeRunner: {
        async runNode<TInput = unknown, TData = unknown>(nodeId: string, input: TInput, onEvent?: (event: NodeRunEventDTO) => void) {
          onEvent?.({ type: "log", message: `running ${nodeId}` })
          return { success: true, message: "done", data: input as unknown as TData }
        },
      },
    })

    const response = await app.handle(new Request("http://localhost/nodes/example/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { value: 42 } }),
    }))
    const body = await response.json() as {
      result: { success: boolean; message: string; data?: unknown }
      events: Array<{ type: string; message: string }>
    }

    expect(response.status).toBe(200)
    expect(body).toEqual({
      result: { success: true, message: "done", data: { value: 42 } },
      events: [{ type: "log", message: "running example" }],
    })
  })

  test("streams node operation events and final results", async () => {
    let releaseRunner!: () => void
    const runnerGate = new Promise<void>((resolve) => {
      releaseRunner = resolve
    })
    const app = await createDefaultBackendApp({
      now: 100,
      repository: createMemoryWorkspaceRepository(),
      nodeRunner: {
        async runNode<TInput = unknown, TData = unknown>(nodeId: string, input: TInput, onEvent?: (event: NodeRunEventDTO) => void) {
          onEvent?.({ type: "log", message: `started ${nodeId}` })
          await runnerGate
          onEvent?.({ type: "progress", progress: 1, message: `finished ${nodeId}` })
          return { success: true, message: "streamed", data: input as unknown as TData }
        },
      },
    })

    const start = await app.handle(new Request("http://localhost/nodes/example/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { value: 7 } }),
    }))
    const started = await start.json() as { operation: { operationId: string; phase: string } }

    expect(start.status).toBe(200)
    expect(started.operation.operationId).toBeTruthy()

    const stream = await app.handle(new Request(`http://localhost/node-operations/${started.operation.operationId}/stream`))
    const streamText = stream.text()
    await sleep(5)
    releaseRunner()

    const messages = parseNdjson(await streamText)
    const eventMessages = messages
      .filter((message): message is { type: "event"; event: NodeRunEventDTO } => message.type === "event")
      .map((message) => message.event.message)
    const result = messages.find((message): message is { type: "result"; result: { success: boolean; message: string; data?: unknown } } => message.type === "result")

    expect(stream.status).toBe(200)
    expect(eventMessages).toEqual(["started example", "finished example"])
    expect(result?.result).toEqual({ success: true, message: "streamed", data: { value: 7 } })
  })

  test("supports operation event pagination, cancellation, and cleanup routes", async () => {
    let releaseRunner!: () => void
    const runnerGate = new Promise<void>((resolve) => {
      releaseRunner = resolve
    })
    const app = await createDefaultBackendApp({
      now: 100,
      repository: createMemoryWorkspaceRepository(),
      nodeRunner: {
        async runNode(nodeId, _input, onEvent) {
          onEvent?.({ type: "log", message: `started ${nodeId}` })
          onEvent?.({ type: "log", message: `waiting ${nodeId}` })
          await runnerGate
          onEvent?.({ type: "log", message: `late ${nodeId}` })
          return { success: true, message: "late success" }
        },
      },
    })

    const start = await app.handle(new Request("http://localhost/nodes/example/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { value: 9 } }),
    }))
    const started = await start.json() as { operation: { operationId: string } }
    await sleep(5)

    const events = await app.handle(new Request(`http://localhost/node-operations/${started.operation.operationId}/events?from=1&limit=1`))
    const eventPage = await events.json() as {
      events: Array<{ index: number; event: { message: string } }>
      next?: number
      total: number
    }

    const cancel = await app.handle(new Request(`http://localhost/node-operations/${started.operation.operationId}/cancel`, {
      method: "POST",
    }))
    const cancelled = await cancel.json() as { operation: { phase: string; result: { success: boolean; message: string } } }

    releaseRunner()
    await sleep(5)

    const cleanup = await app.handle(new Request("http://localhost/node-operations?maxAgeMs=0", {
      method: "DELETE",
    }))
    const cleaned = await cleanup.json() as { removedCount: number; remainingCount: number }

    expect(events.status).toBe(200)
    expect(eventPage).toMatchObject({
      events: [{ index: 1, event: { message: "waiting example" } }],
      total: 2,
    })
    expect(eventPage.next).toBeUndefined()
    expect(cancel.status).toBe(200)
    expect(cancelled.operation.phase).toBe("cancelled")
    expect(cancelled.operation.result).toEqual({ success: false, message: "Node operation cancelled." })
    expect(cleanup.status).toBe(200)
    expect(cleaned).toEqual({ removedCount: 1, remainingCount: 0 })
  })

  test("uses a libSQL database in the configured data directory", async () => {
    const dataDir = await createTempDataDir()
    try {
      const config = resolveBackendDatabaseConfig({ dataDir })
      expect(config.path).toBe(join(dataDir, "xiranite.db"))

      const first = await createDefaultBackend({ dataDir, now: 100 })
      const configFilePath = join(dataDir, "xiranite.config.toml")
      await expect(readFile(configFilePath, "utf8")).resolves.toContain("[workspace]")
      await first.repository.renameWorkspace("ws-default", "Persisted", 200)
      first.close()

      const second = await createDefaultBackend({ dataDir, now: 300 })
      const workspaces = await second.repository.listWorkspaces()
      expect(workspaces).toEqual([{ id: "ws-default", label: "Persisted", createdAt: 100, updatedAt: 200 }])
      second.close()
    } finally {
      await removeWithWindowsRetry(dataDir)
    }
  })

  test("resolves database config from explicit local paths", async () => {
    const dataDir = join("tmp", "xiranite-custom-data")
    expect(resolveBackendDataDir({ dataDir })).toBe(resolve(dataDir))

    const fromDataDir = resolveBackendDatabaseConfig({ dataDir })
    expect(fromDataDir.path).toBe(join(resolve(dataDir), "xiranite.db"))
    expect(fromDataDir.url).toBe(pathToFileURL(join(resolve(dataDir), "xiranite.db")).href)

    const databasePath = join("tmp", "xiranite-custom.db")
    const fromDatabasePath = resolveBackendDatabaseConfig({ dataDir, databasePath })
    expect(fromDatabasePath.path).toBe(resolve(databasePath))
    expect(fromDatabasePath.url).toBe(pathToFileURL(resolve(databasePath)).href)
  })

  test("resolves remote libSQL config without a local path", () => {
    const config = resolveBackendDatabaseConfig({
      databaseUrl: "libsql://xiranite-example.turso.io",
      databaseAuthToken: "remote-token",
    })

    expect(config).toEqual({
      url: "libsql://xiranite-example.turso.io",
      path: undefined,
      authToken: "remote-token",
    })
  })

  test("parses backend CLI database overrides", () => {
    const options = parseBackendCliArgs([
      "--host",
      "0.0.0.0",
      "--port",
      "8123",
      "--token",
      "dev-token",
      "--data-dir",
      "portable-data",
      "--database-auth-token",
      "remote-token",
    ])

    expect(options).toEqual({
      help: undefined,
      hostname: "0.0.0.0",
      port: 8123,
      token: "dev-token",
      configPath: undefined,
      databaseUrl: undefined,
      databasePath: undefined,
      dataDir: "portable-data",
      databaseAuthToken: "remote-token",
    })
  })

  test("protects local service routes with a token", async () => {
    const backend = await startBackend({ token: "test-token", repository: createMemoryWorkspaceRepository() })
    try {
      const blocked = await fetch(`${backend.url}/workspace`)
      expect(blocked.status).toBe(401)

      const allowed = await fetch(`${backend.url}/workspace`, {
        headers: { "x-xiranite-token": "test-token" },
      })
      expect(allowed.status).toBe(200)
    } finally {
      backend.close()
    }
  })

  test("serves token-protected local image files as streamed browser assets", async () => {
    const dataDir = await createTempDataDir()
    const imagePath = join(dataDir, "preview.png")
    await writeFile(imagePath, ONE_PIXEL_PNG)
    const backend = await startBackend({ token: "test-token", repository: createMemoryWorkspaceRepository() })
    try {
      const blocked = await fetch(`${backend.url}/local-files?path=${encodeURIComponent(imagePath)}`)
      expect(blocked.status).toBe(401)

      const allowed = await fetch(`${backend.url}/local-files?path=${encodeURIComponent(imagePath)}&token=test-token`)
      expect(allowed.status).toBe(200)
      expect(allowed.headers.get("content-type")).toBe("image/png")
      expect(allowed.headers.get("x-content-type-options")).toBe("nosniff")
      expect(Buffer.from(await allowed.arrayBuffer())).toEqual(ONE_PIXEL_PNG)
    } finally {
      backend.close()
      await removeWithWindowsRetry(dataDir)
    }
  })

  test("rejects invalid native local picker requests before opening a dialog", async () => {
    const backend = await startBackend({ token: "test-token", repository: createMemoryWorkspaceRepository() })
    try {
      const response = await fetch(`${backend.url}/local-files/pick?token=test-token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "upload" }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: "kind must be files or directory" })
    } finally {
      backend.close()
    }
  })

  test("routes validated local paths to the native file clipboard", async () => {
    const writeClipboardFiles = vi.fn(async () => undefined)
    const backend = await startBackend({ token: "test-token", repository: createMemoryWorkspaceRepository(), writeClipboardFiles })
    try {
      const blocked = await fetch(`${backend.url}/local-files/clipboard`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paths: ["D:/Media/a.jpg"] }),
      })
      expect(blocked.status).toBe(401)

      const invalid = await fetch(`${backend.url}/local-files/clipboard?token=test-token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paths: [] }),
      })
      expect(invalid.status).toBe(400)

      const response = await fetch(`${backend.url}/local-files/clipboard?token=test-token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paths: ["D:/Media/a.jpg", "D:/Media/b.jpg"] }),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ copied: 2 })
      expect(writeClipboardFiles).toHaveBeenCalledWith(["D:/Media/a.jpg", "D:/Media/b.jpg"])
    } finally {
      backend.close()
    }
  })

  test("serves local audio files with range support and lists music entries", async () => {
    const dataDir = await createTempDataDir()
    const musicDir = join(dataDir, "music")
    const audioPath = join(musicDir, "track.flac")
    await mkdir(musicDir, { recursive: true })
    await writeFile(audioPath, TINY_FLAC_HEADER)
    await writeFile(join(musicDir, "notes.txt"), "not audio")
    const backend = await startBackend({ token: "test-token", repository: createMemoryWorkspaceRepository() })
    try {
      const listed = await fetch(`${backend.url}/local-files/list?path=${encodeURIComponent(musicDir)}&recursive=1&extensions=.flac,.mp3&token=test-token`)
      const body = await listed.json() as {
        entries: Array<{ name: string; path: string; type: string; sizeBytes: number }>
      }

      expect(listed.status).toBe(200)
      expect(body.entries).toMatchObject([{
        name: "track.flac",
        path: audioPath,
        type: "audio/flac",
        sizeBytes: TINY_FLAC_HEADER.length,
        isDirectory: false,
      }])

      const range = await fetch(`${backend.url}/local-files?path=${encodeURIComponent(audioPath)}&token=test-token`, {
        headers: { range: "bytes=0-3" },
      })

      expect(range.status).toBe(206)
      expect(range.headers.get("content-type")).toBe("audio/flac")
      expect(range.headers.get("accept-ranges")).toBe("bytes")
      expect(range.headers.get("content-range")).toBe(`bytes 0-3/${TINY_FLAC_HEADER.length}`)
      expect(Buffer.from(await range.arrayBuffer())).toEqual(Buffer.from("fLaC"))
    } finally {
      backend.close()
      await removeWithWindowsRetry(dataDir)
    }
  })

  test("allows browser CORS preflight for token-authenticated routes", async () => {
    const backend = await startBackend({ token: "test-token", repository: createMemoryWorkspaceRepository() })
    try {
      const preflight = await fetch(`${backend.url}/nodes/recycleu/operations`, {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:5173",
          "access-control-request-method": "PATCH",
          "access-control-request-headers": "content-type,x-xiranite-token",
        },
      })

      expect(preflight.status).toBe(204)
      expect(preflight.headers.get("access-control-allow-origin")).toBe("*")
      expect(preflight.headers.get("access-control-allow-methods")).toContain("PATCH")
      expect(preflight.headers.get("access-control-allow-headers")).toContain("x-xiranite-token")
    } finally {
      backend.close()
    }
  })

  test("[neoview.http.e2e] [neoview.scheduler.host-injection] [neoview.settings.runtime-backend] lazily mounts the configured reader routes", async () => {
    const dataDir = await createTempDataDir()
    const configPath = join(dataDir, "xiranite.config.toml")
    const bookDir = await mkdtemp(join(RUN_ROOT, "neoview-book-"))
    await writeFile(join(bookDir, "001.jpg"), ONE_PIXEL_PNG)
    await writeFile(configPath, [
      "[nodes.neoview]",
      "schema_version = 1",
      "[nodes.neoview.reader]",
      "reading_direction = \"right-to-left\"",
      "double_page_view = true",
      "",
    ].join("\n"), "utf8")
    const resourceScheduler = new ResourceSchedulerService()
    const acquireResource = vi.spyOn(resourceScheduler, "acquire")
    const backend = await startBackend({
      token: "test-token",
      repository: createMemoryWorkspaceRepository(),
      dataDir,
      configPath,
      legacyThumbnailDatabasePath: false,
      resourceScheduler,
    })
    try {
      const opened = await fetch(`${backend.url}/reader/sessions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-xiranite-token": "test-token",
        },
        body: JSON.stringify({ path: bookDir }),
      })
      const session = await opened.json() as {
        sessionId: string
        book: { pageCount: number }
        frame: { direction: string; layout: { pageMode: string } }
        visiblePages: Array<{ assetUrl: string; dimensions?: { width: number; height: number } }>
      }
      expect(opened.status).toBe(201)
      expect(session.book.pageCount).toBe(1)
      expect(session.frame).toMatchObject({ direction: "right-to-left", layout: { pageMode: "double" } })
      expect(session.visiblePages[0]?.dimensions).toEqual({ width: 1, height: 1 })

      const image = await fetch(session.visiblePages[0]!.assetUrl)
      expect(image.status).toBe(200)
      expect(image.headers.get("content-type")).toBe("image/jpeg")
      expect(Buffer.from(await image.arrayBuffer())).toEqual(ONE_PIXEL_PNG)

      const transformedUrl = new URL(session.visiblePages[0]!.assetUrl)
      transformedUrl.searchParams.set("width", "1")
      transformedUrl.searchParams.set("format", "webp")
      const transformed = await fetch(transformedUrl)
      const transformedBytes = Buffer.from(await transformed.arrayBuffer())
      expect(transformed.status).toBe(200)
      expect(transformed.headers.get("content-type")).toBe("image/webp")
      expect(transformed.headers.has("content-length")).toBe(false)
      expect(transformed.headers.has("accept-ranges")).toBe(false)
      expect(transformedBytes.subarray(0, 4).toString("ascii")).toBe("RIFF")
      expect(transformedBytes.subarray(8, 12).toString("ascii")).toBe("WEBP")
      const cachedTransform = await fetch(transformedUrl)
      const cachedBytes = Buffer.from(await cachedTransform.arrayBuffer())
      expect(cachedBytes).toEqual(transformedBytes)
      expect(acquireResource).toHaveBeenCalledTimes(1)
      expect(acquireResource).toHaveBeenCalledWith(expect.objectContaining({
        resource: "cpu",
        kind: "neoview.image-transform",
        priority: "interactive",
      }), expect.any(AbortSignal))

      const closed = await fetch(`${backend.url}/reader/s/${session.sessionId}`, {
        method: "DELETE",
        headers: { "x-xiranite-token": "test-token" },
      })
      expect(closed.status).toBe(204)
    } finally {
      await backend.close()
      await Promise.all([removeWithWindowsRetry(dataDir), removeWithWindowsRetry(bookDir)])
    }
  })
})

async function createTempDataDir(): Promise<string> {
  const tmpRoot = RUN_ROOT
  await mkdir(tmpRoot, { recursive: true })
  return mkdtemp(join(tmpRoot, "xiranite-backend-"))
}

function parseNdjson(text: string): Array<{ type: string; [key: string]: unknown }> {
  return text.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { type: string; [key: string]: unknown })
}

async function removeWithWindowsRetry(path: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EBUSY" && attempt === 9) return
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error
      await sleep(25)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}
