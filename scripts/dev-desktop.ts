import { startBackend } from "../packages/backend/src/index"
import { removeBackendDevManifest, writeBackendDevManifest } from "./backend-dev-manifest"

const args = process.argv.slice(2)
const frontendUrl = Bun.env.FRONTEND_DEVSERVER_URL ?? `http://127.0.0.1:${Bun.env.XIRANITE_FRONTEND_PORT ?? "5173"}`
const frontend = new URL(frontendUrl)
const frontendPort = frontend.port || (frontend.protocol === "https:" ? "443" : "80")

const backend = await startBackend()
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
  stdin: "inherit",
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
  backend.close()
  vite.kill()
  go?.kill()
  void removeBackendDevManifest()
}

process.on("SIGINT", stop)
process.on("SIGTERM", stop)
process.on("exit", () => backend.close())

try {
  await waitForFrontend()

  go = Bun.spawn(["go", "run", "-mod=mod", "."], {
    stdin: "inherit",
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
