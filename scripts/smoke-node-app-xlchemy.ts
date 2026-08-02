#!/usr/bin/env bun
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"

type Manifest = { node: { id: string }; snapshotId: string }
type Operation = {
  operationId: string
  phase: "queued" | "running" | "paused" | "completed" | "cancelled" | "error"
  result?: {
    success?: boolean
    data?: {
      convertedCount?: number
      files?: Array<{ outputPath?: string; status?: string }>
    }
  }
}

const parsed = parseArgs({
  args: process.argv.slice(2),
  options: { "node-id": { type: "string" }, manifest: { type: "string" } },
})
const nodeId = parsed.values["node-id"]
const manifestPath = parsed.values.manifest
if (nodeId !== "xlchemy" || !manifestPath) throw new Error("XLchemy release gate requires --node-id xlchemy and --manifest.")

const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest
if (manifest.node.id !== nodeId) throw new Error("XLchemy release gate manifest does not match the target node.")

const root = await mkdtemp(join(tmpdir(), "xiranite-node-app-xlchemy-gate-"))
const sourceDir = join(root, "source")
const resultDir = join(root, "result")
const cancelledSourceDir = join(root, "cancelled-source")
const cancelledResultDir = join(root, "cancelled-result")
const dataDir = join(root, "data")
const token = crypto.randomUUID()
let backend: Bun.Subprocess | undefined

try {
  await Promise.all([
    mkdir(sourceDir, { recursive: true }),
    mkdir(resultDir, { recursive: true }),
    mkdir(cancelledSourceDir, { recursive: true }),
    mkdir(cancelledResultDir, { recursive: true }),
  ])
  const source = join(sourceDir, "fixture.png")
  await writeFile(source, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64"))
  await Promise.all(Array.from({ length: 24 }, (_, index) => copyFile(source, join(cancelledSourceDir, `cancel-${index}.png`))))

  backend = Bun.spawn([
    process.execPath,
    "internal/desktop/build/xiranite-backend.js",
    "--node-id", nodeId,
    "--snapshot-id", manifest.snapshotId,
    "--token", token,
    "--data-dir", dataDir,
  ], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env, APPDATA: root, LOCALAPPDATA: root, XIRANITE_DATA_DIR: dataDir },
  })
  const ready = await withTimeout(readReadyLine(backend.stdout), 15_000, "XLchemy backend did not report readiness")
  if (ready.token !== token || !ready.baseUrl) throw new Error("XLchemy backend returned an invalid readiness payload.")

  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(new URL(path, ready.baseUrl), {
      ...init,
      headers: { "x-xiranite-token": token, ...init.headers },
    })
    if (!response.ok) throw new Error(`XLchemy release gate request ${path} failed (${response.status}): ${await response.text()}`)
    return response
  }
  const start = async (input: Record<string, unknown>): Promise<Operation> => {
    const response = await request(`/nodes/${nodeId}/operations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input }),
    })
    return (await response.json() as { operation: Operation }).operation
  }

  const conversion = await start(conversionInput([source], resultDir))
  const completed = await waitForOperation(request, conversion.operationId)
  const output = completed.result?.data?.files?.find((file) => file.status === "converted")?.outputPath
  if (completed.phase !== "completed" || !completed.result?.success || completed.result.data?.convertedCount !== 1 || !output || !await exists(output)) {
    throw new Error(`XLchemy conversion did not produce a real AVIF result: ${JSON.stringify(completed)}`)
  }
  const events = await (await request(`/node-operations/${conversion.operationId}/events?from=0&limit=64`)).json() as {
    events?: Array<{ event?: { type?: string; progress?: number } }>
  }
  if (!events.events?.some(({ event }) => event?.type === "progress" && typeof event.progress === "number")) {
    throw new Error(`XLchemy conversion did not emit progress events: ${JSON.stringify(events)}`)
  }

  const cancellable = await start(conversionInput([cancelledSourceDir], cancelledResultDir))
  const cancelledResponse = await request(`/node-operations/${cancellable.operationId}/cancel`, { method: "POST" })
  const cancelled = (await cancelledResponse.json() as { operation: Operation }).operation
  if (cancelled.phase !== "cancelled") throw new Error(`XLchemy cancellation was not accepted: ${JSON.stringify(cancelled)}`)
  const settledCancellation = await waitForOperation(request, cancellable.operationId)
  if (settledCancellation.phase !== "cancelled") throw new Error(`XLchemy operation did not remain cancelled: ${JSON.stringify(settledCancellation)}`)

  const history = await waitForHistory(request)
  if (!history.items.some((item) => item.nodeId === nodeId && item.status === "success") || !history.items.some((item) => item.nodeId === nodeId && item.status === "cancelled")) {
    throw new Error(`XLchemy run history is incomplete: ${JSON.stringify(history)}`)
  }

  console.log("[node-app] XLchemy conversion, progress, cancellation, result, and history gates passed")
} finally {
  backend?.kill()
  if (backend) await withTimeout(backend.exited, 5_000, "XLchemy release-gate backend did not exit").catch(() => undefined)
  await removeWithWindowsRetry(root)
}

function conversionInput(paths: string[], outputDir: string): Record<string, unknown> {
  return {
    action: "convert",
    paths,
    format: "AVIF",
    avifEncoder: "slimg",
    quality: 60,
    outputMode: "directory",
    outputDir,
    overwrite: true,
    existingPolicy: "replace",
    preserveMetadata: false,
    metadataMode: "encoder-wipe",
    recursive: true,
    threads: 1,
  }
}

async function waitForOperation(request: (path: string, init?: RequestInit) => Promise<Response>, operationId: string): Promise<Operation> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const operation = await (await request(`/node-operations/${operationId}`)).json() as Operation
    if (["completed", "cancelled", "error"].includes(operation.phase)) return operation
    await sleep(50)
  }
  throw new Error(`XLchemy operation ${operationId} did not settle.`)
}

async function waitForHistory(request: (path: string, init?: RequestInit) => Promise<Response>): Promise<{ items: Array<{ nodeId?: string; status?: string }> }> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const history = await (await request("/node-run-history?limit=20")).json() as { items: Array<{ nodeId?: string; status?: string }> }
    if (history.items.some((item) => item.status === "success") && history.items.some((item) => item.status === "cancelled")) return history
    await sleep(50)
  }
  throw new Error("XLchemy run history was not persisted.")
}

async function readReadyLine(stdout: ReadableStream<Uint8Array>): Promise<{ baseUrl?: string; token?: string }> {
  const reader = stdout.getReader()
  const decoder = new TextDecoder()
  let output = ""
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) throw new Error(`XLchemy backend exited before readiness: ${output.trim()}`)
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
