import { mkdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = resolve(packageRoot, "..", "..")
const nativeRoot = join(workspaceRoot, "native")
const profile = process.argv.includes("--debug") ? "debug" : "release"
const args = ["build", "-p", "xiranite-image-node"]
if (profile === "release") args.push("--release")

const processResult = Bun.spawnSync(["cargo", ...args], {
  cwd: nativeRoot,
  stdout: "inherit",
  stderr: "inherit",
})
if (!processResult.success) process.exit(processResult.exitCode)

const libraryName = process.platform === "win32"
  ? "xiranite_image_node.dll"
  : process.platform === "darwin"
    ? "libxiranite_image_node.dylib"
    : "libxiranite_image_node.so"
const source = join(nativeRoot, "target", profile, libraryName)
const destination = join(packageRoot, "native", `xiranite-image-native.${process.platform}-${process.arch}.node`)
await mkdir(dirname(destination), { recursive: true })
await Bun.write(destination, Bun.file(source))
console.log(`Native binding: ${destination}`)
