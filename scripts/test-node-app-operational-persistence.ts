#!/usr/bin/env bun
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

interface StartedBackend {
  process: Bun.Subprocess
  url: string
  token: string
}

const root = await mkdtemp(join(tmpdir(), "xiranite-node-app-persistence-"))
const dataDir = join(root, "data")
const configPath = join(dataDir, "xiranite.config.toml")
const databaseUrl = pathToFileURL(join(dataDir, "xiranite.db")).href
const deletedPath = join(root, "delete-from-direct-host.txt")
const copySourcePath = join(root, "copy-from-direct-host.txt")
const copyDestinationPath = join(root, "copied-by-direct-host.txt")
let mainBackend: StartedBackend | undefined
let nodeBackend: StartedBackend | undefined

try {
  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(join(root, "NeoView"), { recursive: true }),
  ])
  await writeFile(deletedPath, "delete me", "utf8")
  await writeFile(copySourcePath, "copy me", "utf8")

  mainBackend = await startBackend("packages/backend/src/index.ts", "main-token", [
    "--config", configPath,
    "--data-dir", dataDir,
    "--database-url", databaseUrl,
  ])
  nodeBackend = await startBackend("packages/backend/src/nodeApp.ts", "node-token", [
    "--node-id", "neoview",
    "--snapshot-id", "persistence-integration",
    "--config-path", configPath,
    "--data-dir", dataDir,
    "--database-url", databaseUrl,
    "--enable-reader",
  ])

  const capabilities = await request(nodeBackend, "/node-app/capabilities")
  const capabilityBody = await capabilities.json() as { capabilities?: string[] }
  assert(capabilities.ok && capabilityBody.capabilities?.includes("persistent-file-operations"), "Node app did not declare persistent-file-operations.")

  const executed = await request(nodeBackend, "/reader/files/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      confirmed: true,
      operations: [
        { kind: "delete", sourcePath: deletedPath },
        { kind: "copy", sourcePath: copySourcePath, destinationPath: copyDestinationPath },
      ],
    }),
  })
  const executionText = await executed.text()
  assert(executed.ok, `Direct Node App file operation failed (${executed.status}): ${executionText}`)
  const execution = JSON.parse(executionText) as {
    succeeded?: number
    undoPersisted?: boolean
    results?: Array<{ operation?: { kind?: string }; deletionId?: string }>
  }
  const deletionId = execution.results?.find((result) => result.operation?.kind === "delete")?.deletionId
  assert(execution.succeeded === 2 && execution.undoPersisted === true && Boolean(deletionId), "Direct Node App did not persist the delete and undo operation.")
  await expectMissing(deletedPath)
  await access(copyDestinationPath)

  await assertSharedState(mainBackend, deletionId!, deletedPath)
  await stopBackend(nodeBackend)
  nodeBackend = undefined
  await stopBackend(mainBackend)
  mainBackend = undefined

  mainBackend = await startBackend("packages/backend/src/index.ts", "restarted-token", [
    "--config", configPath,
    "--data-dir", dataDir,
    "--database-url", databaseUrl,
  ])
  await assertSharedState(mainBackend, deletionId!, deletedPath)
  console.log("[node-app] direct NeoView deletion history and undo state persisted through the shared backend database")
} finally {
  await stopBackend(nodeBackend)
  await stopBackend(mainBackend)
  await removeWithWindowsRetry(root)
}

async function startBackend(entrypoint: string, token: string, args: string[]): Promise<StartedBackend> {
  const child = Bun.spawn([process.execPath, entrypoint, "--token", token, ...args], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "inherit",
    env: {
      ...process.env,
      APPDATA: root,
      LOCALAPPDATA: root,
      XIRANITE_NODE_SOURCE: "1",
    },
  })
  try {
    const ready = await withTimeout(readReadyLine(child.stdout), 15_000, `${entrypoint} did not report readiness.`)
    assert(ready.baseUrl && ready.token === token, `${entrypoint} returned an invalid readiness payload.`)
    return { process: child, url: ready.baseUrl, token }
  } catch (error) {
    child.kill()
    await child.exited.catch(() => undefined)
    throw error
  }
}

async function request(backend: StartedBackend, requestPath: string, init: RequestInit = {}): Promise<Response> {
  return fetch(new URL(requestPath, backend.url), {
    ...init,
    headers: { "x-xiranite-token": backend.token, ...init.headers },
  })
}

async function assertSharedState(backend: StartedBackend, deletionId: string, sourcePath: string): Promise<void> {
  const history = await request(backend, "/file-deletions?nodeId=neoview")
  const historyText = await history.text()
  assert(history.ok, `Main backend deletion query failed (${history.status}): ${historyText}`)
  const historyBody = JSON.parse(historyText) as { items?: Array<{ id?: string; sourcePath?: string; state?: string }> }
  assert(historyBody.items?.some((item) => item.id === deletionId && item.sourcePath === sourcePath && item.state === "permanent"), "Main backend cannot see the Direct Node App deletion record.")

  const undo = await request(backend, "/reader/files/operations")
  const undoText = await undo.text()
  assert(undo.ok, `Main backend undo query failed (${undo.status}): ${undoText}`)
  const undoBody = JSON.parse(undoText) as { available?: boolean; count?: number; persistent?: boolean }
  assert(undoBody.available === true && undoBody.count === 1 && undoBody.persistent === true, "Main backend cannot recover the Direct Node App undo state.")
}

async function expectMissing(targetPath: string): Promise<void> {
  const found = await access(targetPath).then(() => true).catch(() => false)
  assert(!found, `Expected deleted file to be absent: ${targetPath}`)
}

async function stopBackend(backend: StartedBackend | undefined): Promise<void> {
  if (!backend) return
  backend.process.kill()
  await withTimeout(backend.process.exited, 5_000, "Node App backend did not exit.").catch(() => undefined)
}

async function readReadyLine(stdout: ReadableStream<Uint8Array>): Promise<{ baseUrl?: string; token?: string }> {
  const reader = stdout.getReader()
  const decoder = new TextDecoder()
  let output = ""
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) throw new Error(`Backend exited before readiness: ${output.trim()}`)
      output += decoder.decode(value, { stream: true })
      const newline = output.indexOf("\n")
      if (newline >= 0) return JSON.parse(output.slice(0, newline)) as { baseUrl?: string; token?: string }
    }
  } finally {
    reader.releaseLock()
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function removeWithWindowsRetry(targetPath: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(targetPath, { recursive: true, force: true, maxRetries: 0 })
      return
    } catch (error) {
      lastError = error
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "EBUSY" && code !== "EPERM") throw error
      await new Promise<void>((resolve) => setTimeout(resolve, 1_000))
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
