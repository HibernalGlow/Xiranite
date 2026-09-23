#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { pinnedBunVersion } from "./lib/pinned-bun-version"

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
// Releases embed Bun by default; --no-bun builds the system-Bun variant that
// resolves Bun from PATH, which is the second artifact of each release platform.
const withoutBun = args.includes("--no-bun")
const bunVersion = optionValue("--bun-version") ?? await pinnedBunVersion()
const isWindows = process.platform === "win32"
const goos = isWindows ? "windows" : process.platform === "darwin" ? "darwin" : "linux"
const goarch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : process.arch
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
  if (!withoutBun) {
    await run([
      process.execPath,
      "scripts/fetch-bun-runtime.ts",
      "--os",
      goos,
      "--arch",
      goarch,
      "--version",
      bunVersion,
    ], buildEnv)
  }
  if (isWindows) {
    await run([process.execPath, "run", "wails:syso"], buildEnv)
  }

  const outputPath = optionValue("--output") ?? `build/wails/Xiranite.local${isWindows ? ".exe" : ""}`
  // Wails alpha.98 has no DevTools implementation for its Linux window backend,
  // so the devtools tag only compiles on Windows and macOS; the local release
  // build drops it there instead of shipping a build that cannot start.
  const buildTags = ["production", ...(goos === "linux" ? [] : ["devtools"]), ...(withoutBun ? ["no_bun"] : [])].join(",")
  const ldflags = [
    "-w",
    "-s",
    `-X main.nodeAppMinimumBunVersion=${bunVersion}`,
    ...(isWindows ? ["-H windowsgui"] : []),
    ...(!withoutBun ? [`-X main.embeddedBunVersion=${bunVersion}`] : []),
  ]
  await run([
    "go",
    "build",
    "-mod=mod",
    "-tags",
    buildTags,
    `-ldflags=${ldflags.join(" ")}`,
    "-o",
    outputPath,
    ".",
  ], buildEnv)

  const nativeHostOutput = resolve(repoRoot, dirname(outputPath), process.platform === "win32" ? "xiranite-native-host.exe" : "xiranite-native-host")
  await run(["go", "build", "-mod=mod", "-o", nativeHostOutput, "./cmd/xiranite-native-host"], buildEnv)

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
