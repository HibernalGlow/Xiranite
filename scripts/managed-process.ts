import { resolve } from "node:path"

export function spawnManagedVite(args: readonly string[], options: Bun.SpawnOptions.OptionsObject) {
  return Bun.spawn([process.execPath, resolve(import.meta.dir, "..", "node_modules", "vite", "bin", "vite.js"), ...args], options)
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
