import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const packagesRoot = resolve(packageRoot, "..")

for (const packageName of ["arcthumb-native", "czkawka-native"]) {
  const result = Bun.spawnSync(["bun", "run", "build:native"], {
    cwd: resolve(packagesRoot, packageName),
    stdout: "inherit",
    stderr: "inherit",
  })
  if (!result.success) process.exit(result.exitCode)
}
