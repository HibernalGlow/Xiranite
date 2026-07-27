import { loadFindzNativeClient, type FindzAnalysisScope, type FindzLibraryOpenParams } from "@xiranite/findz-native"
import type { FindzWorkerMethod, FindzWorkerRequest, FindzWorkerResponse } from "./worker-protocol.js"
import { FindzLibraryWatch, type FindzWatcherEvent } from "./watcher-service.js"

const nativeClient = loadFindzNativeClient()
const watches = new Map<string, FindzLibraryWatch>()
const openLibraries = new Set<string>()

globalThis.addEventListener("message", (event: MessageEvent<FindzWorkerRequest>) => {
  void handleRequest(event.data).then(
    (result) => {
      post({ id: event.data.id, ok: true, result })
      if (event.data.method === "shutdown") globalThis.close()
    },
    (error) => post({ id: event.data.id, ok: false, error: { message: errorMessage(error) } }),
  )
})

async function handleRequest(request: FindzWorkerRequest): Promise<unknown> {
  switch (request.method) {
    case "api.info":
      return await nativeClient.getApiInfo()
    case "library.open": {
      const library = await nativeClient.openLibrary(request.params as FindzLibraryOpenParams)
      openLibraries.add(library.libraryId)
      return await startLibraryWatch(library.libraryId, library.root, library)
    }
    case "library.close": {
      const { libraryId } = request.params as { libraryId: string }
      await stopLibraryWatch(libraryId)
      await nativeClient.closeLibrary(libraryId)
      openLibraries.delete(libraryId)
      if (!watches.size) nativeClient.close()
      return undefined
    }
    case "scan.start":
      return await nativeClient.startScan((request.params as { libraryId: string }).libraryId)
    case "watcher.apply_changes": {
      const params = request.params as { libraryId: string; changes: FindzWatcherEvent[] }
      return await nativeClient.applyWatcherChanges(params.libraryId, params.changes)
    }
    case "analysis.start": {
      const params = request.params as { libraryId: string; scope?: FindzAnalysisScope }
      return await nativeClient.startAnalysis(params.libraryId, params.scope)
    }
    case "task.get": {
      const params = request.params as { libraryId: string; taskId: string }
      return await nativeClient.getTask(params.libraryId, params.taskId)
    }
    case "task.pause":
    case "task.resume":
    case "task.cancel": {
      const params = request.params as { libraryId: string; taskId: string }
      if (request.method === "task.pause") return await nativeClient.pauseTask(params.libraryId, params.taskId)
      if (request.method === "task.resume") return await nativeClient.resumeTask(params.libraryId, params.taskId)
      return await nativeClient.cancelTask(params.libraryId, params.taskId)
    }
    case "query.archives":
      return await nativeClient.queryArchives(request.params as Parameters<typeof nativeClient.queryArchives>[0])
    case "export.rows":
      return await nativeClient.exportRows(request.params as Parameters<typeof nativeClient.exportRows>[0])
    case "query.members":
      return await nativeClient.queryMembers(request.params as Parameters<typeof nativeClient.queryMembers>[0])
    case "projection.treemap":
      return await nativeClient.getTreemap(request.params as Parameters<typeof nativeClient.getTreemap>[0])
    case "shutdown":
      await shutdownWorker()
      return undefined
  }
  return assertNever(request.method)
}

async function shutdownWorker(): Promise<void> {
  for (const libraryId of [...openLibraries]) {
    await stopLibraryWatch(libraryId)
    await nativeClient.closeLibrary(libraryId)
    openLibraries.delete(libraryId)
  }
  nativeClient.close()
}

async function startLibraryWatch(libraryId: string, root: string, summary: Awaited<ReturnType<typeof nativeClient.openLibrary>>) {
  const current = watches.get(libraryId)
  if (current?.root === root) return summary
  await stopLibraryWatch(libraryId)
  try {
    const watcher = await import("@parcel/watcher")
    const watch = new FindzLibraryWatch(libraryId, root, nativeClient)
    const subscription = await watcher.subscribe(root, (error, events) => {
      if (error) {
        void watch.degrade()
        return
      }
      watch.queue(events)
    })
    watch.setSubscription(subscription)
    watches.set(libraryId, watch)
    return await nativeClient.setWatcherHealth(libraryId, "healthy")
  } catch {
    const degraded = await nativeClient.setWatcherHealth(libraryId, "degraded")
    try {
      await nativeClient.startScan(libraryId)
    } catch {
      // Keep the degraded state visible when native reconciliation cannot start.
    }
    return degraded
  }
}

async function stopLibraryWatch(libraryId: string): Promise<void> {
  const watch = watches.get(libraryId)
  if (!watch) return
  watches.delete(libraryId)
  await watch.close()
}

function post(response: FindzWorkerResponse): void {
  globalThis.postMessage(response)
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Findz worker method: ${String(value)}`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
