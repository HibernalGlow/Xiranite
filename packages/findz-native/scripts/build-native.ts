import { mkdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = resolve(packageRoot, "..", "..")
const coreRoot = join(workspaceRoot, "native", "findz-go")

// Keep in sync with `findzLibraryFilename` in src/index.ts. The mapping is
// duplicated on purpose so this script stays runnable before the workspace
// packages (including @xiranite/platform) have been built.
function sharedLibraryExtension(): string {
  if (process.platform === "win32") return ".dll"
  return process.platform === "darwin" ? ".dylib" : ".so"
}

const artifactPath = join(
  workspaceRoot,
  "native",
  "artifacts",
  `${process.platform}-${process.arch}`,
  `findz${sharedLibraryExtension()}`,
)

// The core is plain Go with cgo, so every Go-supported host can build it; the
// result is only ever loaded by the matching `process.platform`-`process.arch`.
if (!["win32", "darwin", "linux"].includes(process.platform)) {
  throw new Error(`Findz native assets are not built for ${process.platform}.`)
}

await mkdir(dirname(artifactPath), { recursive: true })
const result = Bun.spawnSync(["go", "build", "-buildmode=c-shared", "-o", artifactPath, "."], {
  cwd: coreRoot,
  env: { ...process.env, CGO_ENABLED: "1" },
  stdout: "inherit",
  stderr: "inherit",
})
if (!result.success) process.exit(result.exitCode)
console.log(`Findz native core: ${artifactPath}`)
