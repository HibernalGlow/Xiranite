import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const packagesRoot = resolve(packageRoot, "..")

for (const packageName of ["arcthumb-native", "czkawka-native"]) {
  const result = spawnSync("bun", ["run", "build:native"], {
    cwd: resolve(packagesRoot, packageName),
    stdio: "inherit",
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
