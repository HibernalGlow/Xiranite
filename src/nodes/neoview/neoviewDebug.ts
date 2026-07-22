/**
 * NeoView freeze diagnostics.
 *
 * Always prints in DEV (no ?debug=1 required). When startup debug is enabled,
 * events are also mirrored into window.__xiraniteDebug.
 */
import { startupDebug } from "@/lib/startupDebug"

export interface NeoviewLiveInstance {
  compId: string
  path?: string
  mountedAt: number
}

const liveInstances = new Map<string, NeoviewLiveInstance>()
let sequence = 0

export function neoviewLiveCount(): number {
  return liveInstances.size
}

export function neoviewLiveSnapshot(): NeoviewLiveInstance[] {
  return [...liveInstances.values()]
}

export function noteNeoviewMount(compId: string, detail?: { path?: string }): number {
  const mountedAt = performance.now()
  liveInstances.set(compId, {
    compId,
    path: detail?.path,
    mountedAt,
  })
  const count = liveInstances.size
  neoviewDebug("instance:mount", {
    compId,
    path: detail?.path || undefined,
    live: count,
    liveIds: [...liveInstances.keys()],
  })
  return count
}

export function noteNeoviewUnmount(compId: string): number {
  const previous = liveInstances.get(compId)
  liveInstances.delete(compId)
  const count = liveInstances.size
  neoviewDebug("instance:unmount", {
    compId,
    livedMs: previous ? Math.round(performance.now() - previous.mountedAt) : undefined,
    live: count,
    liveIds: [...liveInstances.keys()],
  })
  return count
}

export function neoviewDebug(label: string, detail?: unknown): void {
  if (!import.meta.env.DEV) return

  const event = {
    sequence: ++sequence,
    t: Math.round(performance.now() * 10) / 10,
    live: liveInstances.size,
    label,
    detail,
  }

  const prefix = `[neoview #${event.sequence} t=${event.t}ms live=${event.live}] ${label}`
  if (detail === undefined) console.info(prefix)
  else console.info(prefix, detail)

  startupDebug(`neoview:${label}`, {
    live: event.live,
    ...(detail === undefined ? {} : { detail }),
  })
}

export async function neoviewDebugAsync<T>(label: string, operation: () => T | PromiseLike<T>, detail?: unknown): Promise<T> {
  const startedAt = performance.now()
  neoviewDebug(`${label}:begin`, detail)
  try {
    const result = await operation()
    neoviewDebug(`${label}:end`, {
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      ...(detail === undefined ? {} : { detail }),
    })
    return result
  } catch (error) {
    neoviewDebug(`${label}:error`, {
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      error,
      ...(detail === undefined ? {} : { detail }),
    })
    throw error
  }
}
