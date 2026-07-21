import { stopProcessTree } from "./managed-process"

const frontendUrl = Bun.env.FRONTEND_DEVSERVER_URL ?? `http://127.0.0.1:${Bun.env.XIRANITE_FRONTEND_PORT ?? "5173"}`

async function waitForFrontend() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(frontendUrl, { method: "HEAD" })
      if (response.ok || response.status === 404) {
        const runtime = await fetch(new URL("/node_modules/.vite/deps/@wailsio_runtime.js", frontendUrl))
        if (runtime.ok) return
      }
    } catch {
      // The existing dev server is still starting, or has not been launched yet.
    }
    await Bun.sleep(150)
  }
  throw new Error(`Vite dev server is not reachable: ${frontendUrl}. Start it with "bun run dev" first.`)
}

await waitForFrontend()
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
