import { watch, type FSWatcher } from "node:fs"
import { resolve } from "node:path"

export interface NeoviewBackendWatcher {
  close(): void
}

export function isNeoviewBackendSourceFile(filename: string): boolean {
  const normalized = filename.replaceAll("\\", "/")
  return (/\.(?:ts|tsx)$/).test(normalized)
    && !(/\.(?:test|spec)\.(?:ts|tsx)$/).test(normalized)
}

export function watchNeoviewBackendSource(restart: () => Promise<unknown>): NeoviewBackendWatcher {
  const sourceDirectory = resolve(import.meta.dirname, "../packages/nodes/neoview/src")
  let timer: ReturnType<typeof setTimeout> | undefined
  let restarting = false
  let pending = false

  const runRestart = async () => {
    if (restarting) {
      pending = true
      return
    }
    restarting = true
    try {
      await restart()
    } catch (error) {
      console.error("[xiranite-backend:watch] restart failed", error)
    } finally {
      restarting = false
      if (pending) {
        pending = false
        void runRestart()
      }
    }
  }

  const scheduleRestart = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void runRestart()
    }, 180)
  }

  let watcher: FSWatcher
  try {
    watcher = watch(sourceDirectory, { recursive: process.platform === "win32" || process.platform === "darwin" }, (_event, filename) => {
      if (filename && !isNeoviewBackendSourceFile(String(filename))) return
      scheduleRestart()
    })
    watcher.on("error", (error) => console.error("[xiranite-backend:watch] watcher failed", error))
  } catch (error) {
    console.error("[xiranite-backend:watch] unable to watch NeoView source", error)
    return { close() {} }
  }

  console.log(`[xiranite-backend:watch] ${sourceDirectory}`)
  return {
    close() {
      if (timer) clearTimeout(timer)
      watcher.close()
    },
  }
}
