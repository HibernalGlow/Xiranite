import { removeBackendDevManifest, writeBackendDevManifest } from "./backend-dev-manifest"
import { consumeDevSessionStopRequest, removeDevSession, writeDevSession } from "./dev-session"
import { managedViteCacheDir, resolveManagedFrontendUrl } from "./dev-frontend-url"
import { waitForFrontendReady } from "./frontend-readiness"
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
// Opt-in behaviour at the runtime level; enabled by default for desktop dev
// while allowing `XIRANITE_NODE_SOURCE_HMR=0` to retain the previous cache.
process.env.XIRANITE_NODE_SOURCE_HMR ??= "1"
const { startBackend } = await import("../packages/backend/src/index")
const frontendUrl = await resolveManagedFrontendUrl()
const frontend = new URL(frontendUrl)
const frontendPort = frontend.port || (frontend.protocol === "https:" ? "443" : "80")

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
  const next = await startManagedBackend()
  backend = next
  await writeBackendDevManifest({ baseUrl: next.url, token: next.token }, frontendUrl)
  console.log(`[xiranite-backend:restart] ${next.url}`)
  if (previous) setTimeout(() => previous.close(), 250)
  return {
    restarted: true,
    supported: true,
    message: "Local backend restarted by the desktop dev supervisor.",
    config: { baseUrl: next.url, token: next.token },
  }
}

backend = await startManagedBackend()
await writeBackendDevManifest({ baseUrl: backend.url, token: backend.token }, frontendUrl)
neoviewWatcher = watchNeoviewBackendSource(restartBackendFromDevScript)
console.log(`[xiranite-backend] ${backend.url}`)
console.log(`[xiranite-frontend] ${frontendUrl}`)

const removedTemps = await clearStaleViteOptimizeTemps()
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
    XIRANITE_VITE_CACHE_DIR: managedViteCacheDir(),
  },
})

let go: ReturnType<typeof Bun.spawn> | null = null
let stopping = false

async function stop() {
  if (stopping) return
  stopping = true
  neoviewWatcher?.close()
  backend?.close()
  await Promise.all([stopProcessTree(vite), ...(go ? [stopProcessTree(go)] : [])])
  await Promise.all([removeBackendDevManifest(frontendUrl), removeDevSession()])
}

await writeDevSession({
  supervisorPid: process.pid,
  childPids: [vite.pid],
  script: "dev-desktop",
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

try {
  await waitForFrontendReady(frontendUrl)
  console.log(`[xiranite-frontend:ready] ${frontendUrl}`)

  // A Wails desktop window does not need its own Windows console. Keep the
  // terminal available only when explicitly requested for Go-side debugging.
  const goArgs = ["go", "run", "-mod=mod"]
  if (process.platform === "win32" && Bun.env.XIRANITE_DESKTOP_TERMINAL !== "1") {
    goArgs.push("-ldflags=-H=windowsgui")
  }
  goArgs.push(".")

  go = Bun.spawn(goArgs, {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...Bun.env,
      FRONTEND_DEVSERVER_URL: frontendUrl,
      XIRANITE_BACKEND_URL: backend.url,
      XIRANITE_BACKEND_TOKEN: backend.token,
    },
  })
  await writeDevSession({
    supervisorPid: process.pid,
    childPids: [vite.pid, go.pid],
    script: "dev-desktop",
    startedAt: devSessionStartedAt,
    frontendUrl,
  })

  const exitCode = await go.exited
  await stop()
  process.exit(exitCode ?? 0)
} catch (error) {
  await stop()
  console.error(error)
  process.exit(1)
}
