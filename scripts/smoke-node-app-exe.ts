#!/usr/bin/env bun
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"

type SmokeMarker = {
  nodeId?: string
  snapshotId?: string
  backendBaseUrl?: string
  backendToken?: string
  windowCreated?: boolean
}

const parsed = parseArgs({
  args: process.argv.slice(2),
  options: {
    exe: { type: "string" },
    "node-id": { type: "string" },
    "snapshot-id": { type: "string" },
    "upscale-models-directory": { type: "string" },
    "upscayl-path": { type: "string" },
  },
})
const exe = parsed.values.exe
const nodeId = parsed.values["node-id"]
const snapshotId = parsed.values["snapshot-id"]
if (!exe || !nodeId || !snapshotId) throw new Error("--exe, --node-id, and --snapshot-id are required.")
const upscaleModelsDirectory = parsed.values["upscale-models-directory"]
  ?? process.env.XIRANITE_NODE_APP_SMOKE_UPSCALE_MODELS_DIRECTORY
const upscaylPath = parsed.values["upscayl-path"]
  ?? process.env.XIRANITE_NODE_APP_SMOKE_UPSCAYL_PATH
if (Boolean(upscaleModelsDirectory) !== Boolean(upscaylPath)) {
  throw new Error("Real upscale smoke requires both --upscale-models-directory and --upscayl-path.")
}
const exerciseUpscale = nodeId === "neoview" && Boolean(upscaleModelsDirectory && upscaylPath)

const root = await mkdtemp(join(tmpdir(), "xiranite-node-app-exe-smoke-"))
const dataDirectory = join(root, "data")
await Promise.all([
  mkdir(join(root, "NeoView"), { recursive: true }),
  mkdir(dataDirectory, { recursive: true }),
])
if (exerciseUpscale) {
  await writeFile(join(dataDirectory, "xiranite.config.toml"), realUpscaleConfig({
    modelsDirectory: upscaleModelsDirectory!,
    upscaylPath: upscaylPath!,
    cacheDirectory: join(root, "upscale-artifacts"),
  }), "utf8")
}
const markerPath = join(root, "startup.json")
const shutdownPath = join(root, "shutdown")
const environment = {
  ...process.env,
  APPDATA: root,
  LOCALAPPDATA: root,
  XIRANITE_DATA_DIR: dataDirectory,
  XIRANITE_NODE_APP_SMOKE_MARKER: markerPath,
  XIRANITE_NODE_APP_SMOKE_SHUTDOWN_FILE: shutdownPath,
}
let primary: Bun.Subprocess | undefined
let secondary: Bun.Subprocess | undefined
let primaryReachedStartup = false
const upscaylProcessBaseline = exerciseUpscale ? await processCount("upscayl-bin.exe") : undefined
try {
  primary = Bun.spawn([exe], { env: environment, stdout: "ignore", stderr: "ignore" })
  const marker = await waitForMarker(markerPath)
  if (!marker.windowCreated || marker.nodeId !== nodeId || marker.snapshotId !== snapshotId || !marker.backendBaseUrl) {
    throw new Error("Standalone node executable did not create the expected window and backend boundary.")
  }
  primaryReachedStartup = true
  const health = await fetch(new URL("/health", marker.backendBaseUrl))
  const body = await health.json() as { nodeId?: string; snapshotId?: string }
  if (!health.ok || body.nodeId !== nodeId || body.snapshotId !== snapshotId) {
    throw new Error("Standalone node executable backend handshake did not match the snapshot.")
  }
  if (nodeId === "neoview") {
    if (!marker.backendToken) throw new Error("NeoView executable smoke marker did not expose its isolated backend token.")
    const capability = await fetch(new URL("/reader/upscale-capabilities", marker.backendBaseUrl), {
      headers: { "x-xiranite-token": marker.backendToken },
    })
    const capabilityText = await capability.text()
    const capabilityBody = parseJson(capabilityText) as { available?: boolean; models?: unknown[] } | undefined
    if (!capability.ok || capabilityBody?.available !== true || !capabilityBody.models?.length) {
      throw new Error(`NeoView executable super-resolution runtime is unavailable (${capability.status}): ${capabilityText}`)
    }
    if (exerciseUpscale) {
      await verifyRealUpscale(marker.backendBaseUrl, marker.backendToken, root)
    }
  }

  secondary = Bun.spawn([exe], { env: environment, stdout: "ignore", stderr: "ignore" })
  await withTimeout(secondary.exited, 8_000, "second standalone node process did not exit after IPC focus request")
  const primaryExit = await Promise.race([
    primary.exited.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250)),
  ])
  if (primaryExit) throw new Error("primary standalone node process exited after a second launch")
  console.log(`[node-app] EXE smoke passed for ${nodeId} (${snapshotId})`)
} finally {
  secondary?.kill()
  if (secondary) await withTimeout(secondary.exited, 5_000, "second standalone node process did not exit").catch(() => undefined)
  if (primary && primaryReachedStartup) {
    await writeFile(shutdownPath, "quit\n", "utf8")
    const exited = await withTimeout(primary.exited, 15_000, "standalone node process did not exit cleanly").then(() => true).catch(() => false)
    if (!exited) primary.kill()
  } else {
    primary?.kill()
  }
  if (primary) await withTimeout(primary.exited, 5_000, "primary standalone node process did not exit").catch(() => undefined)
  let processCleanupError: unknown
  if (upscaylProcessBaseline !== undefined) {
    processCleanupError = await waitForProcessCleanup("upscayl-bin.exe", upscaylProcessBaseline)
      .then(() => undefined)
      .catch((error: unknown) => error)
  }
  await removeSmokeRoot(root)
  if (processCleanupError) throw processCleanupError
}

async function verifyRealUpscale(baseUrl: string, token: string, root: string): Promise<void> {
  const sharp = (await import("sharp")).default
  const bookDirectory = join(root, "upscale-book")
  await mkdir(bookDirectory, { recursive: true })
  const inputWidth = 64
  const inputHeight = 64
  const pixels = Buffer.alloc(inputWidth * inputHeight * 3)
  for (let index = 0; index < pixels.length; index += 1) pixels[index] = (index * 37 + 11) % 256
  await sharp(pixels, { raw: { width: inputWidth, height: inputHeight, channels: 3 } })
    .png({ compressionLevel: 3 })
    .toFile(join(bookDirectory, "001.png"))

  const request = (path: string, init: RequestInit = {}) => fetch(new URL(path, baseUrl), {
    ...init,
    headers: { "x-xiranite-token": token, ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(120_000),
  })
  const openedResponse = await request("/reader/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: bookDirectory }),
  })
  const openedText = await openedResponse.text()
  const opened = parseJson(openedText) as {
    sessionId?: string
    visiblePages?: Array<{ id?: string }>
  } | undefined
  const sessionId = opened?.sessionId
  const pageId = opened?.visiblePages?.[0]?.id
  if (openedResponse.status !== 201 || !sessionId || !pageId) {
    throw new Error(`NeoView executable could not open the real upscale fixture (${openedResponse.status}): ${openedText}`)
  }

  try {
    const upscaleResponse = await request(
      `/reader/s/${encodeURIComponent(sessionId)}/pages/${encodeURIComponent(pageId)}/upscale-artifact`,
      { method: "POST" },
    )
    const upscaleText = await upscaleResponse.text()
    const result = parseJson(upscaleText) as {
      status?: string
      artifactUrl?: string
      bytes?: number
      execution?: { scale?: number; width?: number; height?: number }
    } | undefined
    if (upscaleResponse.status !== 201 || result?.status !== "generated" || !result.artifactUrl || !result.bytes) {
      throw new Error(`NeoView executable real upscale failed (${upscaleResponse.status}): ${upscaleText}`)
    }

    const publicArtifactUrl = new URL(result.artifactUrl)
    const backendArtifactUrl = new URL(`${publicArtifactUrl.pathname}${publicArtifactUrl.search}`, baseUrl)
    const artifactResponse = await fetch(backendArtifactUrl, {
      headers: { "x-xiranite-token": token },
      signal: AbortSignal.timeout(30_000),
    })
    const artifactBytes = Buffer.from(await artifactResponse.arrayBuffer())
    const metadata = await sharp(artifactBytes).metadata()
    const expectedWidth = inputWidth * 2
    const expectedHeight = inputHeight * 2
    if (!artifactResponse.ok
      || artifactResponse.headers.get("content-type") !== "image/png"
      || artifactBytes.length !== result.bytes
      || metadata.width !== expectedWidth
      || metadata.height !== expectedHeight
      || result.execution?.scale !== 2
      || result.execution.width !== expectedWidth
      || result.execution.height !== expectedHeight) {
      throw new Error(`NeoView executable returned an invalid upscale artifact: ${JSON.stringify({
        status: artifactResponse.status,
        contentType: artifactResponse.headers.get("content-type"),
        descriptorBytes: result.bytes,
        actualBytes: artifactBytes.length,
        width: metadata.width,
        height: metadata.height,
        execution: result.execution,
      })}`)
    }
    console.log(`[node-app] EXE real upscale passed (${inputWidth}x${inputHeight} -> ${metadata.width}x${metadata.height}, ${artifactBytes.length} bytes)`)
  } finally {
    await request(`/reader/s/${encodeURIComponent(sessionId)}`, { method: "DELETE" }).catch(() => undefined)
  }
}

function realUpscaleConfig(options: { modelsDirectory: string; upscaylPath: string; cacheDirectory: string }): string {
  return [
    "[nodes.neoview.super_resolution]",
    `upscayl_path = ${tomlString(options.upscaylPath)}`,
    `models_directory = ${tomlString(options.modelsDirectory)}`,
    "max_daemons_per_gpu = 1",
    "",
    "[nodes.neoview.super_resolution.preferences]",
    "schema_version = 1",
    "auto_upscale_enabled = true",
    "pre_upscale_enabled = false",
    'default_model_id = "realesr-animevideov3"',
    "default_scale = 2",
    "conditions = []",
    "",
    "[nodes.neoview.super_resolution.artifact_cache]",
    `directory = ${tomlString(options.cacheDirectory)}`,
    "",
  ].join("\n")
}

function tomlString(value: string): string {
  return JSON.stringify(value.replaceAll("\\", "/"))
}

async function processCount(name: string): Promise<number> {
  const process = Bun.spawn(["tasklist.exe", "/FI", `IMAGENAME eq ${name}`, "/FO", "CSV", "/NH"], {
    stdout: "pipe",
    stderr: "ignore",
    windowsHide: true,
  })
  const output = await new Response(process.stdout).text()
  await process.exited
  return output.split(/\r?\n/u).filter((line) => line.trim().startsWith(`"${name}"`)).length
}

async function waitForProcessCleanup(name: string, baseline: number): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const current = await processCount(name)
    if (current <= baseline) return
    await sleep(100)
  }
  throw new Error(`${name} remained running after the standalone NeoView executable exited.`)
}

async function waitForMarker(path: string): Promise<SmokeMarker> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const content = await readFile(path, "utf8").catch(() => undefined)
    if (content) return JSON.parse(content) as SmokeMarker
    await sleep(100)
  }
  throw new Error("standalone node executable did not reach its startup marker")
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error(message)), timeoutMs) }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

async function removeSmokeRoot(root: string): Promise<void> {
  let lastError: unknown
  // Bun's fs.rm retry options are not consistently honoured on Windows. A
  // bounded explicit loop leaves genuine leaked WebView2 handles as failures.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true })
      return
    } catch (error) {
      lastError = error
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined
      if (code !== "EBUSY" && code !== "EPERM") throw error
      await sleep(250)
    }
  }
  throw lastError
}
