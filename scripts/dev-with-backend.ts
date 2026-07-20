import { removeBackendDevManifest, writeBackendDevManifest } from "./backend-dev-manifest"
import { consumeDevSessionStopRequest, removeDevSession, writeDevSession } from "./dev-session"
import { resolveManagedFrontendUrl } from "./dev-frontend-url"

const devSessionStartedAt = Date.now()
process.env.XIRANITE_LAZY_NODE_BUILD = "1"
process.env.XIRANITE_NODE_SOURCE = "1"
process.env.XIRANITE_NODE_SOURCE_HMR ??= "1"
const { startBackend } = await import("../packages/backend/src/index")

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
  await writeBackendDevManifest({ baseUrl: next.url, token: next.token })
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
await writeBackendDevManifest({ baseUrl: backend.url, token: backend.token })
const args = process.argv.slice(2)
const frontendUrl = await resolveManagedFrontendUrl()
const frontend = new URL(frontendUrl)
const frontendPort = frontend.port || (frontend.protocol === "https:" ? "443" : "80")

console.log(`[xiranite-backend] ${backend.url}`)
console.log(`[xiranite-frontend] ${frontendUrl}`)

const vite = Bun.spawn([
  process.execPath,
  "x",
  "vite",
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
    ...Bun.env,
    VITE_XIRANITE_BACKEND_URL: backend.url,
    VITE_XIRANITE_BACKEND_TOKEN: backend.token,
    VITE_XIRANITE_FRONTEND_DEV_URL: frontendUrl,
  },
})

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  backend?.close()
  vite.kill()
  await Promise.all([removeBackendDevManifest(), removeDevSession()])
}

await writeDevSession({ supervisorPid: process.pid, childPids: [vite.pid], script: "dev-with-backend", startedAt: devSessionStartedAt })
const stopRequestPoll = setInterval(() => {
  void consumeDevSessionStopRequest().then((requested) => { if (requested) void stop() })
}, 100)
stopRequestPoll.unref()
process.on("SIGINT", () => { void stop() })
process.on("SIGTERM", () => { void stop() })
process.on("exit", () => { backend?.close(); void removeDevSession() })

const exitCode = await vite.exited
await stop()
process.exit(exitCode ?? 0)
