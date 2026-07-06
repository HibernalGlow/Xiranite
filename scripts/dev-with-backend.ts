import { startBackend } from "../packages/backend/src/index"

const backend = await startBackend()
const args = process.argv.slice(2)
const frontendUrl = Bun.env.FRONTEND_DEVSERVER_URL ?? `http://127.0.0.1:${Bun.env.XIRANITE_FRONTEND_PORT ?? "5173"}`
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

let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  backend.close()
  vite.kill()
}

process.on("SIGINT", stop)
process.on("SIGTERM", stop)
process.on("exit", () => backend.close())

const exitCode = await vite.exited
backend.close()
process.exit(exitCode ?? 0)
