import { startBackend } from "../packages/backend/src/index"

const backend = await startBackend()
const args = process.argv.slice(2)

console.log(`[xiranite-backend] ${backend.url}`)

const vite = Bun.spawn([process.execPath, "x", "vite", ...args], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...Bun.env,
    VITE_XIRANITE_BACKEND_URL: backend.url,
    VITE_XIRANITE_BACKEND_TOKEN: backend.token,
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
