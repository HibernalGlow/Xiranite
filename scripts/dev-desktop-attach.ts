import { waitForFrontendReady } from "./frontend-readiness"
import { desktopHostShutdownPath, DEV_DESKTOP_SHUTDOWN_PATH_ENV, removeDesktopHostShutdownRequest, stopDesktopHost } from "./desktop-host-lifecycle"

const frontendUrl = Bun.env.FRONTEND_DEVSERVER_URL ?? `http://127.0.0.1:${Bun.env.XIRANITE_FRONTEND_PORT ?? "5173"}`
const startedAt = Date.now()
const desktopShutdownPath = desktopHostShutdownPath(startedAt)

await waitForFrontendReady(frontendUrl, { profile: "desktop" }).catch(() => {
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
    [DEV_DESKTOP_SHUTDOWN_PATH_ENV]: desktopShutdownPath,
  },
})

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  await stopDesktopHost(go, desktopShutdownPath)
}

process.on("SIGINT", () => { void stop() })
process.on("SIGTERM", () => { void stop() })
process.on("exit", () => { void removeDesktopHostShutdownRequest(desktopShutdownPath) })

const exitCode = await go.exited
await stop()
process.exit(exitCode ?? 0)
