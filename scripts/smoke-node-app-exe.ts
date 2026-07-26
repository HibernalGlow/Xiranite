#!/usr/bin/env bun
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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
  },
})
const exe = parsed.values.exe
const nodeId = parsed.values["node-id"]
const snapshotId = parsed.values["snapshot-id"]
if (!exe || !nodeId || !snapshotId) throw new Error("--exe, --node-id, and --snapshot-id are required.")

const root = await mkdtemp(join(tmpdir(), "xiranite-node-app-exe-smoke-"))
const markerPath = join(root, "startup.json")
const shutdownPath = join(root, "shutdown")
const environment = {
  ...process.env,
  APPDATA: root,
  LOCALAPPDATA: root,
  XIRANITE_DATA_DIR: join(root, "data"),
  XIRANITE_NODE_APP_SMOKE_MARKER: markerPath,
  XIRANITE_NODE_APP_SMOKE_SHUTDOWN_FILE: shutdownPath,
}
let primary: Bun.Subprocess | undefined
let secondary: Bun.Subprocess | undefined
let primaryReachedStartup = false
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
  await removeSmokeRoot(root)
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
