import { randomBytes } from "node:crypto"
import { backendGatewayTargetPath, removeBackendGatewayTarget, writeBackendGatewayTarget } from "./backend-gateway"
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
// Opt-in behaviour at the runtime level; enabled by default for desktop dev
// while allowing `XIRANITE_NODE_SOURCE_HMR=0` to retain the previous cache.
process.env.XIRANITE_NODE_SOURCE_HMR ??= "1"
const [{ startBackend }, { invalidateDevelopmentSourceModules }] = await Promise.all([
  import("../packages/backend/src/index"),
  import("../packages/runtime/src/node-runner"),
])
const frontendUrl = await resolveManagedFrontendUrl()
const frontend = new URL(frontendUrl)
const frontendPort = frontend.port || (frontend.protocol === "https:" ? "443" : "80")
const viteCacheDir = managedViteCacheDir(frontendUrl)
const gatewayTargetPath = backendGatewayTargetPath(frontendUrl)
const backendToken = randomBytes(24).toString("base64url")

type DevBackend = Awaited<ReturnType<typeof startBackend>>

let backend: DevBackend | null = null
let neoviewWatcher: NeoviewBackendWatcher | null = null
let restartQueue = Promise.resolve()
let scheduledRestart: ReturnType<typeof setTimeout> | undefined

async function startManagedBackend(): Promise<DevBackend> {
  return await startBackend({
    token: backendToken,
    publicBaseUrl: frontendUrl,
    system: {
      restartBackend: scheduleBackendRestartFromHttp,
    },
  })
}

async function restartBackendFromDevScript() {
  const restart = restartQueue.then(async () => {
    const previous = backend
    backend = null
    await removeBackendGatewayTarget(frontendUrl)
    await previous?.close()
    invalidateDevelopmentSourceModules()
    const next = await startManagedBackend()
    backend = next
    await writeBackendGatewayTarget({ baseUrl: next.url, token: next.token }, frontendUrl)
    console.log(`[xiranite-backend:restart] ${next.url}`)
    return {
      restarted: true,
      supported: true,
      message: "Local backend restarted by the desktop dev supervisor.",
      config: { baseUrl: frontendUrl, token: backendToken },
    }
  })
  restartQueue = restart.then(() => undefined, () => undefined)
  return await restart
}

async function scheduleBackendRestartFromHttp() {
  if (!scheduledRestart) {
    scheduledRestart = setTimeout(() => {
      scheduledRestart = undefined
      void restartBackendFromDevScript().catch((error) => {
        console.error("[xiranite-backend:restart] scheduled restart failed", error)
      })
    }, 250)
  }
  return {
    restarted: false,
    supported: true,
    message: "Local backend restart scheduled by the desktop dev supervisor.",
    config: { baseUrl: frontendUrl, token: backendToken },
  }
}

backend = await startManagedBackend()
await writeBackendGatewayTarget({ baseUrl: backend.url, token: backend.token }, frontendUrl)
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
    VITE_XIRANITE_BACKEND_URL: frontendUrl,
    VITE_XIRANITE_BACKEND_TOKEN: backendToken,
    XIRANITE_BACKEND_GATEWAY_TARGET: gatewayTargetPath,
    VITE_XIRANITE_FRONTEND_DEV_URL: frontendUrl,
    XIRANITE_VITE_CACHE_DIR: viteCacheDir,
  },
})

let go: ReturnType<typeof Bun.spawn> | null = null
let stopping = false

async function stop() {
  if (stopping) return
  stopping = true
  neoviewWatcher?.close()
  if (scheduledRestart) clearTimeout(scheduledRestart)
  await restartQueue
  await backend?.close()
  await Promise.all([stopProcessTree(vite), ...(go ? [stopProcessTree(go)] : [])])
  await Promise.all([removeBackendGatewayTarget(frontendUrl), removeDevSession()])
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
  console.log(formatFrontendWaitLog(frontendUrl, { profile: "desktop" }))
  const ready = await waitForFrontendReady(frontendUrl, { profile: "desktop", sinceMs: devSessionStartedAt })
  console.log(formatFrontendReadyLog(ready))

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
      XIRANITE_BACKEND_URL: frontendUrl,
      XIRANITE_BACKEND_TOKEN: backendToken,
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
