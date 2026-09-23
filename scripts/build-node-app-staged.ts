#!/usr/bin/env bun
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"

const values = readArgs(process.argv.slice(2))
const nodeId = values.get("node-id")
const manifestPath = values.get("manifest")
if (!nodeId || !manifestPath) throw new Error("--node-id and --manifest are required.")

const root = process.cwd()
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
  node: {
    id: string
    name: string
    backendFeatures?: string[]
    nativeProbe?: { module: string; exportName: string }
    releaseGate?: { script: string }
  }
  snapshotId: string
  runtime: { minimumBunVersion: string }
  dataContract: { currentVersion: number; minimumSupportedVersion: number; maximumSupportedVersion: number }
}
if (manifest.node.id !== nodeId) throw new Error(`Manifest node ${manifest.node.id} does not match requested node ${nodeId}.`)

const backendFeatures = manifest.node.backendFeatures ?? []
await prepareStagedWorkspace(root, nodeId, backendFeatures)
// The staged package.json intentionally removes unrelated workspaces. Its
// lockfile is therefore a deterministic build-local derivative of the frozen
// source lockfile and cannot itself be checked with --frozen-lockfile.
await run([process.execPath, "install", "--no-save"])
await run([process.execPath, "scripts/generate-node-registries.ts"], { XIRANITE_BUILD_ONLY_NODES: nodeId })
await run([process.execPath, "scripts/build-packages-lazy.ts", `--only-nodes=${nodeId}`, "--skip-cli"])
// Backend declarations resolve against workspace package dist outputs. Check
// them after the staged base-package build, never against stale root outputs.
await run([process.execPath, "x", "tsc", "--noEmit", "--pretty", "false", "-p", "packages/backend/tsconfig.json"])
// The lazy package build deliberately skips native wrappers in normal app
// development. A standalone backend bundles their JS entrypoints, so produce
// those small TypeScript outputs before invoking Bun's resolver.
await run([process.execPath, "run", "--cwd", "packages/native-loader", "build"])
await run([process.execPath, "run", "--cwd", "packages/czkawka-native", "build"])
if (backendFeatures.includes("reader")) {
  await run([process.execPath, "run", "--cwd", "packages/arcthumb-native", "build"])
}
await run([process.execPath, "x", "vite", "build"], {
  XIRANITE_BUILD_ONLY_NODES: nodeId,
  XIRANITE_NODE_APP_ID: nodeId,
  XIRANITE_NODE_APP_SNAPSHOT_ID: manifest.snapshotId,
  VITE_XIRANITE_NODE_APP_ID: nodeId,
  VITE_XIRANITE_NODE_APP_SNAPSHOT_ID: manifest.snapshotId,
})
await rename(join(root, "dist", "node-app.html"), join(root, "dist", "index.html"))
await copyFile(manifestPath, join(root, "dist", "node-app-manifest.json"))
await run([process.execPath, "scripts/build-backend-js.ts"])
await copyFile(join(root, "build", "wails", "xiranite-node-app-backend.js"), join(root, "build", "wails", "xiranite-backend.js"))
await run([process.execPath, "run", "build:native-assets"])
await run([process.execPath, "run", "wails:syso"])

const enableReader = manifest.node.backendFeatures?.includes("reader") === true ? "true" : "false"
await mkdir(join(root, "build", "node-app"), { recursive: true })
await run([
  "go",
  "build",
  "-mod=mod",
  "-tags",
  // Standalone node apps keep the system-Bun contract: they already gate on
  // runtime.minimumBunVersion, and embedding Bun would add ~120MB per EXE.
  "production,devtools,no_bun",
  "-ldflags",
  `-w -s -H windowsgui -X main.nodeAppID=${nodeId} -X main.nodeAppTitle=${manifest.node.name} -X main.nodeAppSnapshotID=${manifest.snapshotId} -X main.nodeAppMinimumBunVersion=${manifest.runtime.minimumBunVersion} -X main.nodeAppBuildBunVersion=${manifest.toolchain.bun} -X main.nodeAppDataContractVersion=${manifest.dataContract.currentVersion} -X main.nodeAppMinimumDataContractVersion=${manifest.dataContract.minimumSupportedVersion} -X main.nodeAppMaximumDataContractVersion=${manifest.dataContract.maximumSupportedVersion} -X main.nodeAppEnableReader=${enableReader}`,
  "-o",
  "build/node-app/node-app.exe",
  ".",
])
await run([
  process.execPath,
  "scripts/verify-node-app-staged.ts",
  "--node-id",
  nodeId,
  "--manifest",
  manifestPath,
])
if (manifest.node.releaseGate) {
  await run([
    process.execPath,
    manifest.node.releaseGate.script,
    "--node-id",
    nodeId,
    "--manifest",
    manifestPath,
  ], { XIRANITE_NATIVE_ASSET_ROOT: join(root, "build", "wails", "native-assets") })
}
await run([
  process.execPath,
  "scripts/smoke-node-app-exe.ts",
  "--exe",
  "build/node-app/node-app.exe",
  "--node-id",
  nodeId,
  "--snapshot-id",
  manifest.snapshotId,
])

console.log(`[node-app] Staged ${manifest.node.name} (${manifest.snapshotId})`)

async function prepareStagedWorkspace(root: string, nodeId: string, backendFeatures: readonly string[]): Promise<void> {
  const packagePath = join(root, "package.json")
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
    workspaces?: string[]
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const requiresReader = backendFeatures.includes("reader")
  packageJson.workspaces = [
    ...(requiresReader ? ["packages/arcthumb-native"] : []),
    "packages/api",
    "packages/backend",
    "packages/cli-runtime",
    "packages/config",
    "packages/contract",
    "packages/czkawka-native",
    "packages/file-operations",
    "packages/logging",
    "packages/native-loader",
    "packages/repository",
    "packages/runtime",
    "packages/services",
    "packages/shell-integration",
    "packages/shared",
    `packages/nodes/${nodeId}`,
  ]
  for (const section of [packageJson.dependencies, packageJson.devDependencies]) {
    if (!section) continue
    for (const name of Object.keys(section)) {
      if (name.startsWith("@xiranite/node-") && name !== `@xiranite/node-${nodeId}`) delete section[name]
    }
  }
  // These packages are reached by the backend's lazy node imports. The source
  // snapshot contains their workspaces, but Bun only links workspaces exposed
  // by the staged root dependency graph.
  packageJson.dependencies ??= {}
  packageJson.dependencies["@xiranite/czkawka-native"] = "workspace:*"
  if (requiresReader) packageJson.dependencies["@xiranite/arcthumb-native"] = "workspace:*"
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8")
}

async function run(command: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<void> {
  console.log(`[node-app] ${command.join(" ")}`)
  const child = Bun.spawn(command, {
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, ...extraEnv },
  })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`Command failed with exit code ${exitCode}: ${command.join(" ")}`)
}

function readArgs(args: string[]): Map<string, string> {
  const result = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key?.startsWith("--") || !value) throw new Error(`Invalid argument: ${key ?? ""}`)
    result.set(key.slice(2), value)
  }
  return result
}
