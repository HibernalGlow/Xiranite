import { mkdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = resolve(packageRoot, "..", "..")
const coreRoot = join(workspaceRoot, "native", "findz-go")
const artifactPath = join(workspaceRoot, "native", "artifacts", `${process.platform}-${process.arch}`, "findz.dll")

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Findz native assets are currently built only for Windows x64.")
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
