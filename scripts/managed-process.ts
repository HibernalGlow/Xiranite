import { readdir, rm } from "node:fs/promises"
import { resolve } from "node:path"

import { managedViteCacheDir } from "./dev-frontend-url"

export function spawnManagedVite(args: readonly string[], options: Bun.SpawnOptions.OptionsObject) {
  return Bun.spawn([process.execPath, resolve(import.meta.dir, "..", "node_modules", "vite", "bin", "vite.js"), ...args], options)
}

/**
 * Interrupted optimize-deps runs leave `deps_temp_*` directories in the shared
 * managed cache. Clear them before a new supervisor starts so the next cold
 * prebundle can finish instead of thrashing against abandoned temp trees.
 */
export async function clearStaleViteOptimizeTemps(cacheDir = managedViteCacheDir()): Promise<number> {
  let removed = 0
  let entries: string[] = []
  try {
    entries = await readdir(cacheDir)
  } catch {
    return 0
  }
  await Promise.all(entries.map(async (entry) => {
    if (!entry.startsWith("deps_temp_")) return
    await rm(resolve(cacheDir, entry), { recursive: true, force: true })
    removed += 1
  }))
  return removed
}

export async function stopProcessTree(child: ReturnType<typeof Bun.spawn>): Promise<void> {
  if (process.platform === "win32") {
    const taskkill = Bun.spawn(["taskkill", "/PID", String(child.pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    })
    await taskkill.exited
    return
  }

  child.kill("SIGTERM")
  const exited = await Promise.race([
    child.exited.then(() => true),
    Bun.sleep(2_000).then(() => false),
  ])
  if (!exited) {
    child.kill("SIGKILL")
    await child.exited
  }
}
