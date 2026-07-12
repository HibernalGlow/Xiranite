import { startBackend } from "../packages/backend/src/index"
import { removeBackendDevManifest, writeBackendDevManifest } from "./backend-dev-manifest"

const args = process.argv.slice(2)
process.env.XIRANITE_LAZY_NODE_BUILD = "1"
const frontendUrl = Bun.env.FRONTEND_DEVSERVER_URL ?? `http://127.0.0.1:${Bun.env.XIRANITE_FRONTEND_PORT ?? "5173"}`
const frontend = new URL(frontendUrl)
const frontendPort = frontend.port || (frontend.protocol === "https:" ? "443" : "80")

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
    message: "Local backend restarted by the desktop dev supervisor.",
    config: { baseUrl: next.url, token: next.token },
  }
}

backend = await startManagedBackend()
await writeBackendDevManifest({ baseUrl: backend.url, token: backend.token })
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

let go: ReturnType<typeof Bun.spawn> | null = null
let stopping = false

function stop() {
  if (stopping) return
  stopping = true
  backend?.close()
  vite.kill()
  go?.kill()
  void removeBackendDevManifest()
}

process.on("SIGINT", stop)
process.on("SIGTERM", stop)
process.on("exit", () => backend?.close())

try {
  await waitForFrontend()

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

  const exitCode = await go.exited
  stop()
  process.exit(exitCode ?? 0)
} catch (error) {
  stop()
  console.error(error)
  process.exit(1)
}
