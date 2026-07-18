import { BackendSupervisor } from "./backend-supervisor.ts"
import { XiraniteDesktopHost } from "./host.ts"
import { startDesktopAssetServer } from "./static-server.ts"

try {
  await bootstrap()
} catch (error) {
  await reportStartupError(error)
  throw error
}

async function bootstrap(): Promise<void> {
  const backend = await BackendSupervisor.start()

  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    backend.stop()
    void assets?.server.shutdown()
  }

  const host = new XiraniteDesktopHost(backend)
  const assets = startDesktopAssetServer(backend.config, host)
  host.createMainWindow()
  addEventListener("unload", stop)
}

async function reportStartupError(error: unknown): Promise<void> {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error("[xiranite-desktop] startup failed", detail)

  try {
    const dataRoot = Deno.env.get("LOCALAPPDATA")
      ?? Deno.env.get("XDG_STATE_HOME")
      ?? Deno.env.get("HOME")
      ?? Deno.cwd()
    const logDir = `${dataRoot}/Xiranite/logs`
    await Deno.mkdir(logDir, { recursive: true })
    await Deno.writeTextFile(`${logDir}/desktop-startup.log`, `${new Date().toISOString()}\n${detail}\n`)
  } catch (logError) {
    console.error("[xiranite-desktop] failed to write startup log", logError)
  }
}
