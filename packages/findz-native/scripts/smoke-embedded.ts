import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { extractEmbeddedNativeBinding } from "@xiranite/native-loader"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = resolve(packageRoot, "..", "..")
const assetRoot = join(workspaceRoot, "build", "wails", "native-assets")
const cacheRoot = await mkdtemp(join(tmpdir(), "xiranite-findz-embedded-native-"))

try {
  const bindingPath = extractEmbeddedNativeBinding(assetRoot, cacheRoot, "findz")
  const smoke = Bun.spawnSync([process.execPath, "scripts/smoke-native.ts"], {
    cwd: packageRoot,
    env: { ...Bun.env, XIRANITE_FINDZ_NATIVE_PATH: bindingPath },
    stdout: "inherit",
    stderr: "inherit",
  })
  if (!smoke.success) process.exit(smoke.exitCode)
} finally {
  await rm(cacheRoot, { recursive: true, force: true })
}
