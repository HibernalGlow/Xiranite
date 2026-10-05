import { spawnSync } from "node:child_process"
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
  const smoke = spawnSync(process.execPath, ["scripts/smoke-native.ts"], {
    cwd: packageRoot,
    env: { ...process.env, XIRANITE_FINDZ_NATIVE_PATH: bindingPath },
    stdio: "inherit",
  })
  if (smoke.status !== 0) process.exit(smoke.status ?? 1)
} finally {
  await rm(cacheRoot, { recursive: true, force: true })
}
