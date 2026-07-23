import { removeBackendDevManifest, writeBackendDevManifest } from "./backend-dev-manifest"
import { consumeDevSessionStopRequest, removeDevSession, writeDevSession } from "./dev-session"
import { managedViteCacheDir, resolveManagedFrontendUrl } from "./dev-frontend-url"
import { formatFrontendReadyLog, formatFrontendWaitLog, waitForFrontendReady } from "./frontend-readiness"
import { clearStaleViteOptimizeTemps, spawnManagedVite, stopProcessTree } from "./managed-process"
import { viteDevelopmentEnvironment, type ViteDevelopmentMode } from "./vite-dev-environment"
import { watchNeoviewBackendSource, type NeoviewBackendWatcher } from "./neoview-backend-watcher"

const devSessionStartedAt = Date.now()
const args = process.argv.slice(2)
const leanIndex = args.indexOf("--lean-vite")
const viteMode: ViteDevelopmentMode = leanIndex === -1 ? "default" : "lean"
if (leanIndex !== -1) args.splice(leanIndex, 1)
process.env.XIRANITE_LAZY_NODE_BUILD = "1"
process.env.XIRANITE_NODE_SOURCE = "1"
process.env.XIRANITE_NODE_SOURCE_HMR ??= "1"
const [{ startBackend }, { invalidateDevelopmentSourceModules }] = await Promise.all([
  import("../packages/backend/src/index"),
  import("../packages/runtime/src/node-runner"),
])
const frontendUrl = await resolveManagedFrontendUrl()
const frontend = new URL(frontendUrl)
const frontendPort = frontend.port || (frontend.protocol === "https:" ? "443" : "80")
const viteCacheDir = managedViteCacheDir(frontendUrl)

type DevBackend = Awaited<ReturnType<typeof startBackend>>

let backend: DevBackend | null = null
let neoviewWatcher: NeoviewBackendWatcher | null = null

async function startManagedBackend(): Promise<DevBackend> {
  return await startBackend({
    system: {
      restartBackend: restartBackendFromDevScript,
    },
  })
}

async function restartBackendFromDevScript() {
  const previous = backend
  invalidateDevelopmentSourceModules()
  const next = await startManagedBackend()
  backend = next
  await writeBackendDevManifest({ baseUrl: next.url, token: next.token }, frontendUrl)
  console.log(`[xiranite-backend:restart] ${next.url}`)
  if (previous) setTimeout(() => previous.close(), 250)
  return {
    restarted: true,
    supported: true,
    message: "Local backend restarted by the dev supervisor.",
    config: { baseUrl: next.url, token: next.token },
  }
}

backend = await startManagedBackend()
await writeBackendDevManifest({ baseUrl: backend.url, token: backend.token }, frontendUrl)
neoviewWatcher = watchNeoviewBackendSource(restartBackendFromDevScript)

console.log(`[xiranite-backend] ${backend.url}`)
console.log(`[xiranite-frontend] ${frontendUrl}`)

const removedTemps = await clearStaleViteOptimizeTemps(viteCacheDir)
if (removedTemps > 0) console.log(`[xiranite-frontend] cleared ${removedTemps} stale Vite optimize temp(s)`)

const vite = spawnManagedVite([
  "--host",
  frontend.hostname,
  "--port",
  frontendPort,
  "--strictPort",
  ...args,
], {
  stdin: "ignore",
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...viteDevelopmentEnvironment(viteMode),
    VITE_XIRANITE_BACKEND_URL: backend.url,
    VITE_XIRANITE_BACKEND_TOKEN: backend.token,
    VITE_XIRANITE_FRONTEND_DEV_URL: frontendUrl,
    XIRANITE_VITE_CACHE_DIR: viteCacheDir,
  },
})

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  neoviewWatcher?.close()
  backend?.close()
  await stopProcessTree(vite)
  await Promise.all([removeBackendDevManifest(frontendUrl), removeDevSession()])
}

await writeDevSession({
  supervisorPid: process.pid,
  childPids: [vite.pid],
  script: "dev-with-backend",
  startedAt: devSessionStartedAt,
  frontendUrl,
})
const stopRequestPoll = setInterval(() => {
  void consumeDevSessionStopRequest().then((requested) => { if (requested) void stop() })
}, 100)
stopRequestPoll.unref()
process.on("SIGINT", () => { void stop() })
process.on("SIGTERM", () => { void stop() })
process.on("exit", () => { backend?.close(); void removeDevSession() })

// Browser sessions only need the document server listening. Waiting for the
// full WorkspaceLayout/Wails graph made "ready" much slower than Vite itself
// and did not match what dynamic route loading already optimizes for.
// Timing: Vite prints its own "ready in X ms"; the lines below measure our
// probe from spawn until the document/entry paths respond.
console.log(formatFrontendWaitLog(frontendUrl, { profile: "listen" }))
void waitForFrontendReady(frontendUrl, { profile: "listen", sinceMs: devSessionStartedAt }).then((result) => {
  console.log(formatFrontendReadyLog(result))
}).catch((error: unknown) => {
  if (!stopping) console.error(`[xiranite-frontend:not-ready] ${error instanceof Error ? error.message : String(error)}`)
})

const exitCode = await vite.exited
await stop()
process.exit(exitCode ?? 0)
