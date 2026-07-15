import { rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
await rm(join(packageRoot, "dist"), { recursive: true, force: true })

const result = Bun.spawnSync(
  [process.execPath, "x", "tsc", "-p", "tsconfig.json"],
  { cwd: packageRoot, stdout: "inherit", stderr: "inherit" },
)

if (result.exitCode !== 0) process.exit(result.exitCode)
