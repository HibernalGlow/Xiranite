import { startBackend } from "../packages/backend/src/index"
import { removeBackendDevManifest, writeBackendDevManifest } from "./backend-dev-manifest"
import { consumeDevSessionStopRequest, removeDevSession, writeDevSession } from "./dev-session"
import { managedViteCacheDir, resolveManagedFrontendUrl } from "./dev-frontend-url"
import { desktopRuntimePermissionArgs, resolveDenoCommand } from "./deno-desktop-command"
import { clearStaleViteOptimizeTemps, spawnManagedVite } from "./managed-process"
import { viteDevelopmentEnvironment, type ViteDevelopmentMode } from "./vite-dev-environment"

const devSessionStartedAt = Date.now()
const args = process.argv.slice(2)
const leanIndex = args.indexOf("--lean-vite")
const viteMode: ViteDevelopmentMode = leanIndex === -1 ? "default" : "lean"
if (leanIndex !== -1) args.splice(leanIndex, 1)
const frontendUrl = await resolveManagedFrontendUrl()
const frontend = new URL(frontendUrl)
const frontendPort = frontend.port || (frontend.protocol === "https:" ? "443" : "80")

if (await isFrontendReachable()) {
  throw new Error(
    `A frontend server is already reachable at ${frontendUrl}. `
      + "Use bun run dev:desktop:deno:attach instead of starting a second managed Vite server.",
  )
}

type DevBackend = Awaited<ReturnType<typeof startBackend>>

let backend: DevBackend | null = null

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

async function waitForFrontend() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(frontendUrl, { method: "HEAD" })
      if (response.ok || response.status === 404) return
    } catch {
      // Vite is still starting.
    }
    await Bun.sleep(100)
  }
  throw new Error(`Timed out waiting for Vite dev server: ${frontendUrl}`)
}

async function isFrontendReachable(): Promise<boolean> {
  try {
    await fetch(frontendUrl, { method: "HEAD" })
    return true
  } catch {
    return false
  }
}

let desktop: ReturnType<typeof Bun.spawn> | null = null
let stopping = false

async function stop() {
  if (stopping) return
  stopping = true
  backend?.close()
  vite.kill()
  desktop?.kill()
  await Promise.all([removeBackendDevManifest(frontendUrl), removeDevSession()])
}

await writeDevSession({
  supervisorPid: process.pid,
  childPids: [vite.pid],
  script: "dev-desktop-deno",
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
  await waitForFrontend()
  await Bun.sleep(150)
  if (vite.exitCode !== null) {
    throw new Error(
      `Managed Vite exited before Deno Desktop started (exit ${vite.exitCode}). `
        + "If a dev server is already running, use bun run dev:desktop:deno:attach.",
    )
  }
  const deno = resolveDenoCommand()
  desktop = Bun.spawn([
    deno,
    "desktop",
    "--hmr",
    "--backend",
    "webview",
    "--config",
    "desktop/deno/deno.json",
    ...desktopRuntimePermissionArgs(),
    "desktop/deno/main.ts",
  ], {
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
    childPids: [vite.pid, desktop.pid],
    script: "dev-desktop-deno",
    startedAt: devSessionStartedAt,
    frontendUrl,
  })

  const exitCode = await desktop.exited
  await stop()
  process.exit(exitCode ?? 0)
} catch (error) {
  await stop()
  console.error(error)
  process.exit(1)
}
