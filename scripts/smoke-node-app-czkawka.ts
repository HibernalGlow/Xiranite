#!/usr/bin/env bun
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"

type Manifest = { node: { id: string }; snapshotId: string }
type Operation = { operationId: string; phase: string; result?: { success?: boolean; data?: { entries?: Array<{ path?: string }> } } }

const parsed = parseArgs({
  args: process.argv.slice(2),
  options: { "node-id": { type: "string" }, manifest: { type: "string" } },
})
const nodeId = parsed.values["node-id"]
const manifestPath = parsed.values.manifest
if (nodeId !== "czkawka" || !manifestPath) throw new Error("Czkawka release gate requires --node-id czkawka and --manifest.")

const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest
if (manifest.node.id !== nodeId) throw new Error("Czkawka release gate manifest does not match the target node.")

const root = await mkdtemp(join(tmpdir(), "xiranite-node-app-czkawka-gate-"))
const fixture = join(root, "fixture")
const dataDir = join(root, "data")
const token = crypto.randomUUID()
let backend: Bun.Subprocess | undefined
try {
  await mkdir(fixture, { recursive: true })
  const emptyFile = join(fixture, "empty.txt")
  await Promise.all([
    writeFile(emptyFile, ""),
    writeFile(join(fixture, "duplicate-a.txt"), "same-content"),
    writeFile(join(fixture, "duplicate-b.txt"), "same-content"),
  ])

  backend = Bun.spawn([
    process.execPath,
    "build/wails/xiranite-backend.js",
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
  const ready = await withTimeout(readReadyLine(backend.stdout), 15_000, "Czkawka backend did not report readiness")
  if (ready.token !== token || !ready.baseUrl) throw new Error("Czkawka backend returned an invalid readiness payload.")
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(new URL(path, ready.baseUrl), {
      ...init,
      headers: { "x-xiranite-token": token, ...init.headers },
    })
    if (!response.ok) throw new Error(`Czkawka release gate request ${path} failed (${response.status}): ${await response.text()}`)
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

  const scan = await start({ action: "scan", tool: "empty-files", includedDirectories: [fixture], useCache: false })
  const scanResult = await waitForOperation(request, scan.operationId)
  if (scanResult.phase !== "completed" || !scanResult.result?.success || !scanResult.result.data?.entries?.some((entry) => samePath(entry.path, emptyFile))) {
    throw new Error(`Czkawka empty-file scan did not return the fixture result: ${JSON.stringify(scanResult)}`)
  }

  const deletion = await start({ action: "delete", tool: "empty-files", selectedPaths: [emptyFile], deleteMode: "permanent", dryRun: false })
  const deletionResult = await waitForOperation(request, deletion.operationId)
  if (deletionResult.phase !== "completed" || !deletionResult.result?.success || await exists(emptyFile)) {
    throw new Error(`Czkawka file operation did not delete the scanned fixture: ${JSON.stringify(deletionResult)}`)
  }

  const cancellable = await start({ action: "scan", tool: "duplicate-files", includedDirectories: [fixture], useCache: false })
  await request(`/node-operations/${cancellable.operationId}/cancel`, { method: "POST" })
  const cancelled = await waitForOperation(request, cancellable.operationId)
  if (cancelled.phase !== "cancelled") throw new Error(`Czkawka operation cancellation did not reach cancelled phase: ${JSON.stringify(cancelled)}`)

  const history = await waitForHistory(request, 3)
  if (!history.items.some((item) => item.nodeId === nodeId && item.status === "success") || !history.items.some((item) => item.nodeId === nodeId && item.status === "cancelled")) {
    throw new Error(`Czkawka operation history is incomplete: ${JSON.stringify(history)}`)
  }
  console.log("[node-app] Czkawka scan, file operation, cancellation, and history gates passed")
} finally {
  backend?.kill()
  if (backend) await withTimeout(backend.exited, 5_000, "Czkawka release-gate backend did not exit").catch(() => undefined)
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

async function waitForOperation(request: (path: string, init?: RequestInit) => Promise<Response>, operationId: string): Promise<Operation> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const operation = await (await request(`/node-operations/${operationId}`)).json() as Operation
    if (["completed", "cancelled", "error"].includes(operation.phase)) return operation
    await sleep(50)
  }
  throw new Error(`Czkawka operation ${operationId} did not settle.`)
}

async function waitForHistory(request: (path: string, init?: RequestInit) => Promise<Response>, minimum: number): Promise<{ items: Array<{ nodeId?: string; status?: string }> }> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const history = await (await request("/node-run-history?limit=20")).json() as { items: Array<{ nodeId?: string; status?: string }> }
    if (history.items.length >= minimum) return history
    await sleep(50)
  }
  throw new Error("Czkawka operation history was not persisted.")
}

async function readReadyLine(stdout: ReadableStream<Uint8Array>): Promise<{ baseUrl?: string; token?: string }> {
  const reader = stdout.getReader()
  const decoder = new TextDecoder()
  let output = ""
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) throw new Error(`Czkawka backend exited before readiness: ${output.trim()}`)
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

function samePath(left: string | undefined, right: string): boolean {
  return process.platform === "win32"
    ? left?.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US")
    : left === right
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
