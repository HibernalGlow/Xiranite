#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")
const registryPaths = [
  "packages/runtime/src/node-runner.generated.ts",
  "src/components/modules/packageModules.generated.ts",
  "packages/cli/src/node-cli-registry.generated.ts",
].map((relativePath) => resolve(repoRoot, relativePath))
const originalRegistries = await Promise.all(registryPaths.map((filePath) => readFile(filePath, "utf8")))

const args = process.argv.slice(2)
const strict = args.includes("--strict")
const skipTypecheck = !args.includes("--typecheck") || args.includes("--skip-typecheck")
const excludeNodeIds = parseNodeIds(optionValue("--exclude-nodes"))
const onlyNodeIds = parseNodeIds(optionValue("--only-nodes"))
const failuresPath = resolve(repoRoot, ".cache", "local-build-failures.json")
const buildEnv = { ...process.env }
if (excludeNodeIds.length > 0) buildEnv.XIRANITE_BUILD_EXCLUDE_NODES = excludeNodeIds.join(",")
else delete buildEnv.XIRANITE_BUILD_EXCLUDE_NODES
if (onlyNodeIds.length > 0) buildEnv.XIRANITE_BUILD_ONLY_NODES = onlyNodeIds.join(",")
else delete buildEnv.XIRANITE_BUILD_ONLY_NODES

let finalExcludedNodeIds = [...excludeNodeIds]
let completed = false

try {
  await run([process.execPath, "scripts/generate-node-registries.ts"], buildEnv)

  const packageBuildArgs = [
    "scripts/build-packages-lazy.ts",
    ...(excludeNodeIds.length ? [`--exclude-nodes=${excludeNodeIds.join(",")}`] : []),
    ...(onlyNodeIds.length ? [`--only-nodes=${onlyNodeIds.join(",")}`] : []),
    ...(strict ? [] : ["--skip-failed-nodes"]),
    `--failures-file=${failuresPath}`,
  ]
  await run([process.execPath, ...packageBuildArgs], buildEnv)

  const failedNodeIds = JSON.parse(await readFile(failuresPath, "utf8").catch(() => "[]")) as unknown
  if (!Array.isArray(failedNodeIds) || failedNodeIds.some((id) => typeof id !== "string")) {
    throw new Error(`Invalid local build failure report: ${failuresPath}`)
  }
  finalExcludedNodeIds = [...new Set([...finalExcludedNodeIds, ...(failedNodeIds as string[])])]
  if (finalExcludedNodeIds.length > excludeNodeIds.length) {
    buildEnv.XIRANITE_BUILD_EXCLUDE_NODES = finalExcludedNodeIds.join(",")
    await run([process.execPath, "scripts/generate-node-registries.ts"], buildEnv)
    console.warn(`[local-build] Excluded after failed build: ${finalExcludedNodeIds.slice(excludeNodeIds.length).join(", ")}`)
  }

  if (skipTypecheck) {
    console.warn("[local-build] Skipping local typecheck (use --typecheck to enforce it).")
  } else {
    await run([process.execPath, "scripts/typecheck-local-build.ts"], buildEnv)
  }
  await run([process.execPath, "x", "vite", "build"], buildEnv)
  await run([process.execPath, "scripts/audit-build-chunks.ts"], buildEnv)
  await run([process.execPath, "scripts/build-backend-js.ts"], buildEnv)
  await run([process.execPath, "run", "build:native-assets"], buildEnv)
  await run([process.execPath, "run", "wails:syso"], buildEnv)

  const outputPath = optionValue("--output") ?? "build/wails/Xiranite.local.exe"
  await run([
    "go",
    "build",
    "-mod=mod",
    "-tags",
    "production",
    "-ldflags=-w -s -H windowsgui",
    "-o",
    outputPath,
    ".",
  ], buildEnv)

  completed = true
  console.log(`[local-build] Created ${resolve(repoRoot, outputPath)}`)
  if (finalExcludedNodeIds.length > 0) {
    console.warn(`[local-build] Nodes omitted: ${finalExcludedNodeIds.join(", ")}`)
  }
  if (onlyNodeIds.length > 0) {
    console.warn(`[local-build] Only nodes included: ${onlyNodeIds.join(", ")}`)
  }
} finally {
  await Promise.all(registryPaths.map(async (filePath, index) => {
    if (!completed || finalExcludedNodeIds.length > 0 || onlyNodeIds.length > 0) await writeFile(filePath, originalRegistries[index], "utf8")
  }))
}

function optionValue(name: string): string | undefined {
  const index = args.findIndex((arg) => arg === name)
  if (index >= 0) return args[index + 1]
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1)
}

function parseNodeIds(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((id) => id.trim()).filter(Boolean))]
}

async function run(command: string[], env: NodeJS.ProcessEnv): Promise<void> {
  console.log(`[local-build] ${command.join(" ")}`)
  const child = Bun.spawn(command, {
    cwd: repoRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env,
  })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`Command failed with exit code ${exitCode}: ${command.join(" ")}`)
}
