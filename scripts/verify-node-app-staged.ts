#!/usr/bin/env bun
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"

type Manifest = {
  node: {
    id: string
    backendFeatures?: string[]
    nativeProbe?: { module: string; exportName: string }
  }
  snapshotId: string
  dataContract: { currentVersion: number; minimumSupportedVersion: number; maximumSupportedVersion: number }
}

const parsed = parseArgs({
  args: process.argv.slice(2),
  options: {
    "node-id": { type: "string" },
    manifest: { type: "string" },
  },
})
const nodeId = parsed.values["node-id"]
const manifestPath = parsed.values.manifest
if (!nodeId || !manifestPath) throw new Error("--node-id and --manifest are required.")

const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest
if (manifest.node.id !== nodeId) throw new Error(`Manifest node ${manifest.node.id} does not match ${nodeId}.`)

await verifyBackendHandshake(manifest)
if (manifest.node.nativeProbe) {
  const nativeAssetRoot = join(process.cwd(), "build", "wails", "native-assets")
  await readFile(join(nativeAssetRoot, "manifest.json"), "utf8")
  await run([
    process.execPath,
    "scripts/node-app-native-probe.ts",
    "--module",
    manifest.node.nativeProbe.module,
    "--export-name",
    manifest.node.nativeProbe.exportName,
  ], { XIRANITE_NATIVE_ASSET_ROOT: nativeAssetRoot })
}

console.log(`[node-app] Release gates passed for ${nodeId}`)

async function verifyBackendHandshake(snapshot: Manifest): Promise<void> {
  const dataRoot = await mkdtemp(join(tmpdir(), "xiranite-node-app-gate-"))
  const runtimeRoot = join(dataRoot, "runtime")
  const backendBundle = join(runtimeRoot, "xiranite-backend.js")
  const nativeAssetRoot = join(process.cwd(), "build", "wails", "native-assets")
  const token = crypto.randomUUID()
  await Promise.all([
    mkdir(runtimeRoot, { recursive: true }),
    mkdir(join(dataRoot, "NeoView"), { recursive: true }),
  ])
  await copyFile(join(process.cwd(), "build", "wails", "xiranite-backend.js"), backendBundle)
  const command = [
    process.execPath,
    backendBundle,
    "--node-id", snapshot.node.id,
    "--snapshot-id", snapshot.snapshotId,
    "--data-contract-version", String(snapshot.dataContract.currentVersion),
    "--token", token,
    "--data-dir", join(dataRoot, "data"),
  ]
  if (snapshot.node.backendFeatures?.includes("reader")) command.push("--enable-reader")
  const child = Bun.spawn(command, {
    cwd: runtimeRoot,
    stdout: "pipe",
    stderr: "inherit",
    env: {
      ...process.env,
      APPDATA: dataRoot,
      LOCALAPPDATA: dataRoot,
      XIRANITE_DATA_DIR: join(dataRoot, "data"),
      XIRANITE_NATIVE_ASSET_ROOT: nativeAssetRoot,
    },
  })
  try {
    const ready = await withTimeout(readReadyLine(child.stdout), 15_000, "bundled node backend did not report readiness")
    if (ready.token !== token || !ready.baseUrl) throw new Error("Bundled node backend returned an invalid readiness payload.")
    const headers = { "x-xiranite-token": token }
    const health = await fetch(new URL("/health", ready.baseUrl), { headers })
    const healthBody = await health.json() as { nodeId?: string; snapshotId?: string }
    if (!health.ok || healthBody.nodeId !== snapshot.node.id || healthBody.snapshotId !== snapshot.snapshotId) {
      throw new Error("Bundled node backend health handshake does not match the snapshot.")
    }
    const state = await fetch(new URL("/node-app/state", ready.baseUrl), {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ patch: { releaseGate: snapshot.snapshotId } }),
    })
    if (!state.ok) throw new Error(`Bundled node backend state handshake failed (${state.status}).`)
    const replacedState = await fetch(new URL("/node-app/state", ready.baseUrl), {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ data: { releaseGate: `validated-${snapshot.snapshotId}` } }),
    })
    if (!replacedState.ok) throw new Error(`Bundled node backend state replacement handshake failed (${replacedState.status}).`)
    const runtime = await fetch(new URL("/node-app/runtime", ready.baseUrl), { headers })
    const runtimeBody = await runtime.json() as { dataContract?: { currentVersion?: number } }
    if (!runtime.ok || runtimeBody.dataContract?.currentVersion !== snapshot.dataContract.currentVersion) {
      throw new Error("Bundled node backend did not record the snapshot data contract.")
    }
    if (snapshot.node.backendFeatures?.includes("reader")) {
      const capability = await fetch(new URL("/reader/upscale-capabilities", ready.baseUrl), { headers })
      const capabilityText = await capability.text()
      const capabilityBody = parseJson(capabilityText) as { available?: boolean; reason?: string; models?: unknown[] } | undefined
      if (!capability.ok || capabilityBody?.available !== true || !capabilityBody.models?.length) {
        throw new Error(`Bundled Reader super-resolution runtime is unavailable (${capability.status}): ${capabilityText}`)
      }
    }
  } finally {
    child.kill()
    await withTimeout(child.exited, 5_000, "bundled node backend did not exit").catch(() => undefined)
    await rm(dataRoot, { recursive: true, force: true })
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

async function readReadyLine(stdout: ReadableStream<Uint8Array>): Promise<{ baseUrl?: string; token?: string }> {
  const reader = stdout.getReader()
  const decoder = new TextDecoder()
  let output = ""
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) throw new Error(`Bundled node backend exited before readiness: ${output.trim()}`)
      output += decoder.decode(value, { stream: true })
      const newline = output.indexOf("\n")
      if (newline < 0) continue
      return JSON.parse(output.slice(0, newline)) as { baseUrl?: string; token?: string }
    }
  } finally {
    reader.releaseLock()
  }
}

async function run(command: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<void> {
  console.log(`[node-app] gate ${command.join(" ")}`)
  const child = Bun.spawn(command, {
    cwd: process.cwd(),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, ...extraEnv },
  })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`Release gate failed with exit code ${exitCode}: ${command.join(" ")}`)
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
