import { stat, watch, type FSWatcher } from "node:fs"
import { resolve } from "node:path"

export interface NeoviewBackendWatcher {
  close(): void
}

export interface NeoviewRestartScheduler {
  schedule(): void
  close(): void
}

export function isNeoviewBackendSourceFile(filename: string): boolean {
  const normalized = filename.replaceAll("\\", "/")
  return (/\.(?:ts|tsx)$/).test(normalized)
    && !(/\.(?:test|spec)\.(?:ts|tsx)$/).test(normalized)
    && !normalized.startsWith("cli/")
    && !normalized.startsWith("testing/")
    && !normalized.startsWith("types/")
    && !["Tui.tsx", "cli.ts", "help.ts", "interaction.ts", "ui-core.ts"].includes(normalized)
}

export function createNeoviewRestartScheduler(
  restart: () => Promise<unknown>,
  debounceMs = 180,
): NeoviewRestartScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined
  let restarting = false
  let pending = false
  let closed = false

  const runRestart = async () => {
    if (closed) return
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
      if (pending && !closed) {
        pending = false
        void runRestart()
      } else {
        pending = false
      }
    }
  }

  const scheduleRestart = () => {
    if (closed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void runRestart()
    }, debounceMs)
  }

  return {
    schedule: scheduleRestart,
    close() {
      if (closed) return
      closed = true
      pending = false
      if (timer) clearTimeout(timer)
      timer = undefined
    },
  }
}

export function watchNeoviewBackendSource(restart: () => Promise<unknown>): NeoviewBackendWatcher {
  const sourceDirectory = resolve(import.meta.dirname, "../packages/nodes/neoview/src")
  const fingerprints = new Map<string, string>()
  const scheduler = createNeoviewRestartScheduler(restart)

  const scheduleRestart = () => {
    scheduler.schedule()
  }

  let watcher: FSWatcher
  try {
    watcher = watch(sourceDirectory, { recursive: process.platform === "win32" || process.platform === "darwin" }, (_event, filename) => {
      if (filename && !isNeoviewBackendSourceFile(String(filename))) return
      if (!filename) {
        scheduleRestart()
        return
      }
      const normalized = String(filename).replaceAll("\\", "/")
      stat(resolve(sourceDirectory, normalized), (error, file) => {
        const fingerprint = error ? "missing" : `${file.mtimeMs}:${file.size}`
        if (fingerprints.get(normalized) === fingerprint) return
        fingerprints.set(normalized, fingerprint)
        scheduleRestart()
      })
    })
    watcher.on("error", (error) => console.error("[xiranite-backend:watch] watcher failed", error))
  } catch (error) {
    console.error("[xiranite-backend:watch] unable to watch NeoView source", error)
    return { close() {} }
  }

  console.log(`[xiranite-backend:watch] ${sourceDirectory}`)
  return {
    close() {
      scheduler.close()
      watcher.close()
    },
  }
}
