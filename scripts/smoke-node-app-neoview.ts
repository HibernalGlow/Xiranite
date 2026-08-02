#!/usr/bin/env bun
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { Database } from "bun:sqlite"

type Manifest = { node: { id: string }; snapshotId: string }
type ReaderSession = {
  sessionId?: string
  book?: { pageCount?: number }
  visiblePages?: Array<{ assetUrl?: string }>
}
type ReaderConfig = {
  viewDefaults?: { fitMode?: string }
  imageProcessing?: { readerTransformEnabled?: boolean; sharpFallbackEnabled?: boolean }
}

const parsed = parseArgs({
  args: process.argv.slice(2),
  options: { "node-id": { type: "string" }, manifest: { type: "string" } },
})
const nodeId = parsed.values["node-id"]
const manifestPath = parsed.values.manifest
if (nodeId !== "neoview" || !manifestPath) throw new Error("NeoView release gate requires --node-id neoview and --manifest.")

const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest
if (manifest.node.id !== nodeId) throw new Error("NeoView release gate manifest does not match the target node.")

const root = await mkdtemp(join(tmpdir(), "xiranite-node-app-neoview-gate-"))
const book = join(root, "book")
const dataDir = join(root, "data")
const configPath = join(dataDir, "xiranite.config.toml")
const thumbnailDatabasePath = join(root, "NeoView", "thumbnails.db")
const token = crypto.randomUUID()
let backend: Bun.Subprocess | undefined

try {
  await Promise.all([
    mkdir(book, { recursive: true }),
    mkdir(dataDir, { recursive: true }),
    mkdir(join(root, "NeoView"), { recursive: true }),
  ])
  await writeFile(join(book, "001.jpg"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64"))

  backend = Bun.spawn([
    process.execPath,
    "build/wails/xiranite-backend.js",
    "--node-id", nodeId,
    "--snapshot-id", manifest.snapshotId,
    "--token", token,
    "--data-dir", dataDir,
    "--config-path", configPath,
    "--enable-reader",
  ], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env, APPDATA: root, LOCALAPPDATA: root, XIRANITE_DATA_DIR: dataDir },
  })
  const ready = await withTimeout(readReadyLine(backend.stdout), 15_000, "NeoView backend did not report readiness")
  if (ready.token !== token || !ready.baseUrl) throw new Error("NeoView backend returned an invalid readiness payload.")

  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(new URL(path, ready.baseUrl), {
      ...init,
      headers: { "x-xiranite-token": token, ...init.headers },
    })
    if (!response.ok) throw new Error(`NeoView release gate request ${path} failed (${response.status}): ${await response.text()}`)
    return response
  }

  const openedResponse = await request("/reader/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: book }),
  })
  if (openedResponse.status !== 201) throw new Error(`NeoView Reader open returned ${openedResponse.status}, expected 201.`)
  const session = await openedResponse.json() as ReaderSession
  const firstPage = session.visiblePages?.[0]
  if (!session.sessionId || session.book?.pageCount !== 1 || !firstPage?.assetUrl) {
    throw new Error(`NeoView Reader did not open the temporary book: ${JSON.stringify(session)}`)
  }

  const sourcePage = await fetch(firstPage.assetUrl)
  const sourceBytes = new Uint8Array(await sourcePage.arrayBuffer())
  if (!sourcePage.ok || sourceBytes.length === 0) throw new Error("NeoView Reader page asset route did not return page content.")

  const configuredImageProcessing = await (await request("/reader/config", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageProcessing: { readerTransformEnabled: true, sharpFallbackEnabled: true },
    }),
  })).json() as ReaderConfig
  if (configuredImageProcessing.imageProcessing?.readerTransformEnabled !== true
    || configuredImageProcessing.imageProcessing.sharpFallbackEnabled !== true) {
    throw new Error("NeoView Reader image processing configuration patch was not applied.")
  }
  const configured = await (await request("/reader/config", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      viewDefaults: { fitMode: "original", pageMode: "single" },
    }),
  })).json() as ReaderConfig
  if (configured.viewDefaults?.fitMode !== "original") throw new Error("NeoView Reader configuration patch was not applied.")
  const savedConfig = await readFile(configPath, "utf8")
  if (!savedConfig.includes("[nodes.neoview]")
    || !savedConfig.includes('default_zoom_mode = "original"')
    || !savedConfig.includes("reader_transform_enabled = true")
    || !savedConfig.includes("sharp_fallback_enabled = true")) {
    throw new Error("NeoView Reader configuration was not persisted to the shared config format.")
  }

  const renderedPageUrl = new URL(firstPage.assetUrl)
  renderedPageUrl.searchParams.set("width", "1")
  renderedPageUrl.searchParams.set("format", "webp")
  const renderedPage = await fetch(renderedPageUrl)
  const renderedBytes = new Uint8Array(await renderedPage.arrayBuffer())
  if (!renderedPage.ok || renderedPage.headers.get("content-type") !== "image/webp" || !isWebp(renderedBytes)) {
    const body = new TextDecoder().decode(renderedBytes).slice(0, 512)
    throw new Error(`NeoView Reader rendered-page route did not produce a WebP page (status ${renderedPage.status}, content type ${renderedPage.headers.get("content-type") ?? "none"}): ${body}`)
  }

  const metadataPath = `/reader/s/${encodeURIComponent(session.sessionId)}/emm-metadata`
  const initialMetadata = await (await request(metadataPath)).json() as { revision?: number }
  const patchedMetadata = await (await request(metadataPath, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expectedRevision: initialMetadata.revision ?? 0,
      patch: { rating: 5, translatedTitle: "Node app release gate" },
    }),
  })).json() as { revision?: number; overrides?: { rating?: number; translatedTitle?: string } }
  if (patchedMetadata.revision !== (initialMetadata.revision ?? 0) + 1 || patchedMetadata.overrides?.rating !== 5) {
    throw new Error(`NeoView compatibility metadata was not saved: ${JSON.stringify(patchedMetadata)}`)
  }

  const closeSession = await request(`/reader/s/${encodeURIComponent(session.sessionId)}`, { method: "DELETE" })
  if (closeSession.status !== 204) throw new Error(`NeoView Reader close returned ${closeSession.status}, expected 204.`)

  backend.kill()
  await withTimeout(backend.exited, 5_000, "NeoView release-gate backend did not exit")
  backend = undefined

  if (!await exists(thumbnailDatabasePath)) throw new Error("NeoView compatibility database was not created.")
  const database = new Database(thumbnailDatabasePath, { readonly: true })
  try {
    const row = database.query("SELECT revision, overrides_json FROM xr_reader_emm_overrides LIMIT 1").get() as { revision?: number; overrides_json?: string } | null
    if (row?.revision !== 1 || !row.overrides_json?.includes("Node app release gate")) {
      throw new Error(`NeoView compatibility database did not retain the xr_ override: ${JSON.stringify(row)}`)
    }
  } finally {
    database.close()
  }

  console.log("[node-app] NeoView Reader, rendered page, config, and compatibility database gates passed")
} finally {
  backend?.kill()
  if (backend) await withTimeout(backend.exited, 5_000, "NeoView release-gate backend did not exit").catch(() => undefined)
  await removeWithWindowsRetry(root)
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12
    && new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF"
    && new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP"
}

async function readReadyLine(stdout: ReadableStream<Uint8Array>): Promise<{ baseUrl?: string; token?: string }> {
  const reader = stdout.getReader()
  const decoder = new TextDecoder()
  let output = ""
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) throw new Error(`NeoView backend exited before readiness: ${output.trim()}`)
      output += decoder.decode(value, { stream: true })
      const newline = output.indexOf("\n")
      if (newline >= 0) return JSON.parse(output.slice(0, newline)) as { baseUrl?: string; token?: string }
    }
  } finally {
    reader.releaseLock()
  }
}

async function exists(path: string): Promise<boolean> {
  return await access(path).then(() => true).catch(() => false)
}

async function removeWithWindowsRetry(path: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 0 })
      return
    } catch (error) {
      lastError = error
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "EBUSY" && code !== "EPERM") throw error
      await sleep(1_000)
    }
  }
  throw lastError
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error(message)), timeoutMs) }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
