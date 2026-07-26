#!/usr/bin/env bun
import { constants as fsConstants } from "node:fs"
import { join, resolve } from "node:path"
import { copyFile, mkdir, stat } from "node:fs/promises"
import { createNodeAppSnapshot } from "./lib/node-app-packager.js"

const [nodeId, ...unexpected] = process.argv.slice(2)
if (!nodeId || unexpected.length > 0 || nodeId.startsWith("-")) {
  throw new Error("Usage: bun scripts/package-node-app.ts <nodeId>")
}

const root = resolve(import.meta.dirname, "..")
await runReleasePreflight(root, nodeId)
const snapshot = await createNodeAppSnapshot({ repoRoot: root, nodeId })
const outputDirectory = join(root, "build", "node-apps", nodeId)
const output = join(outputDirectory, `${snapshot.manifest.node.name}-${snapshot.manifest.snapshotId.slice(0, 16)}.exe`)

await mkdir(outputDirectory, { recursive: true })
if (await exists(output)) {
  console.log(`[node-app] Reusing published snapshot: ${output}`)
  process.exit(0)
}

console.log(`[node-app] Frozen ${snapshot.manifest.source.files.length} source files at ${snapshot.stageDirectory}`)
console.log(`[node-app] Snapshot ${snapshot.manifest.snapshotId}`)

const builder = Bun.spawn([
  process.execPath,
  "scripts/build-node-app-staged.ts",
  "--node-id", nodeId,
  "--manifest", snapshot.manifestPath,
], {
  cwd: snapshot.stageDirectory,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env, XIRANITE_NODE_APP_ID: nodeId },
})
const exitCode = await builder.exited
if (exitCode !== 0) throw new Error(`Node app staging build failed with exit code ${exitCode}.`)

const stagedExe = join(snapshot.stageDirectory, "build", "node-app", "node-app.exe")
if (!await exists(stagedExe)) throw new Error(`Node app build did not produce ${stagedExe}.`)
await copyFile(stagedExe, output, fsConstants.COPYFILE_EXCL)
await copyFile(snapshot.manifestPath, output.replace(/\.exe$/, ".manifest.json"), fsConstants.COPYFILE_EXCL)
console.log(`[node-app] Published ${output}`)

async function exists(path: string): Promise<boolean> {
  return await stat(path).then(() => true).catch(() => false)
}

async function runReleasePreflight(root: string, nodeId: string): Promise<void> {
  const gates = [
    [process.execPath, "run", "--cwd", `packages/nodes/${nodeId}`, "test"],
    [process.execPath, "run", "typecheck:app"],
  ]
  for (const command of gates) {
    console.log(`[node-app] preflight ${command.join(" ")}`)
    const child = Bun.spawn(command, { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" })
    const exitCode = await child.exited
    if (exitCode !== 0) throw new Error(`Node app release preflight failed with exit code ${exitCode}: ${command.join(" ")}`)
  }
}
