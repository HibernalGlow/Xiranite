import { waitForFrontendReady } from "./frontend-readiness"
import { stopProcessTree } from "./managed-process"

const frontendUrl = Bun.env.FRONTEND_DEVSERVER_URL ?? `http://127.0.0.1:${Bun.env.XIRANITE_FRONTEND_PORT ?? "5173"}`

await waitForFrontendReady(frontendUrl).catch(() => {
  throw new Error(`Vite application shell is not ready: ${frontendUrl}. Start it with "bun run dev" first.`)
})
console.log(`[xiranite-frontend:attach] ${frontendUrl}`)

const go = Bun.spawn(["go", "run", "-mod=mod", "."], {
  stdin: "ignore",
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...Bun.env,
    FRONTEND_DEVSERVER_URL: frontendUrl,
  },
})

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  await stopProcessTree(go)
}

process.on("SIGINT", () => { void stop() })
process.on("SIGTERM", () => { void stop() })

const exitCode = await go.exited
await stop()
process.exit(exitCode ?? 0)
