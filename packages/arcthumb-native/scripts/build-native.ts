import { spawnSync } from "node:child_process"
import { copyFile, mkdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = resolve(packageRoot, "..", "..")
const nativeRoot = join(workspaceRoot, "native")
const profile = process.argv.includes("--debug") ? "debug" : "release"
const args = ["build", "-p", "xiranite-arcthumb-node"]
if (profile === "release") args.push("--release")
args.push("-j", "1")

const sccache = spawnSync("sccache", ["--version"], { stdio: "ignore" }).error === undefined
const env = sccache && !process.env.RUSTC_WRAPPER
  ? { ...process.env, RUSTC_WRAPPER: "sccache" }
  : process.env

const processResult = spawnSync("cargo", args, {
  cwd: nativeRoot,
  env,
  stdio: "inherit",
})
if (processResult.status !== 0) process.exit(processResult.status ?? 1)

const libraryName = process.platform === "win32"
  ? "xiranite_arcthumb_node.dll"
  : process.platform === "darwin"
    ? "libxiranite_arcthumb_node.dylib"
    : "libxiranite_arcthumb_node.so"
const source = join(nativeRoot, "target", profile, libraryName)
const destination = join(nativeRoot, "artifacts", `${process.platform}-${process.arch}`, `xiranite-arcthumb.${process.platform}-${process.arch}.node`)
await mkdir(dirname(destination), { recursive: true })
await copyFile(source, destination)
console.log(`ArcThumb native binding: ${destination}`)
