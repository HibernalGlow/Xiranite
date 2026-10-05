import { resolve } from "node:path"

import { spawnProcess, runInherit, type ManagedChild } from "./lib/subprocess.ts"
import { consumeDevSessionStopRequest, removeDevSession, writeDevSession } from "./dev-session"
import { managedViteCacheDir, resolveManagedFrontendUrl } from "./dev-frontend-url"
import { formatFrontendReadyLog, formatFrontendWaitLog, waitForFrontendReady } from "./frontend-readiness"
import { clearStaleViteOptimizeTemps, spawnManagedVite, stopProcessTree } from "./managed-process"
import { viteDevelopmentEnvironment, type ViteDevelopmentMode } from "./vite-dev-environment"

const repoRoot = resolve(import.meta.dirname, "..")

/**
 * The origin the Tauri host loads in a dev build: `crates/xiranite-desktop/tauri.conf.json`
 * `build.devUrl`, which `tauri-build` bakes into the binary, so this script cannot choose it freely —
 * it has to match or the window would point at a port nobody is listening on.
 */
const HOST_DEV_URL = new URL("http://localhost:1420")

const devSessionStartedAt = Date.now()
const args = process.argv.slice(2)
const leanIndex = args.indexOf("--lean-vite")
const viteMode: ViteDevelopmentMode = leanIndex === -1 ? "default" : "lean"
if (leanIndex !== -1) args.splice(leanIndex, 1)

// The desktop host starts its own loopback Axum backend on an ephemeral port and hands the WebView
// the channel through `xiranite_bootstrap`, so this supervisor contributes only the document server
// and the host process: no backend URL, no bearer token, no restart handshake.
process.env.XIRANITE_FRONTEND_PORT ??= HOST_DEV_URL.port

const frontendUrl = await resolveManagedFrontendUrl()
if (frontendUrl.endsWith("/")) throw new Error(`frontend URL must not end with a slash: ${frontendUrl}`)
if (new URL(frontendUrl).port !== HOST_DEV_URL.port) {
  throw new Error(
    `frontend URL ${frontendUrl} does not match the host devUrl port ${HOST_DEV_URL.port}; `
    + "unset XIRANITE_FRONTEND_PORT or change crates/xiranite-desktop/tauri.conf.json `build.devUrl`.",
  )
}

const frontend = new URL(frontendUrl)
const frontendPort = frontend.port || (frontend.protocol === "https:" ? "443" : "80")
const viteCacheDir = managedViteCacheDir(frontendUrl)

// Compiling the host takes longer than warming Vite, so the two run concurrently and the window
// opens as soon as both are ready.
const release = process.env.XIRANITE_DESKTOP_RELEASE === "1"
const hostBuild = runInherit(["cargo", "build", "-p", "xiranite-desktop", ...(release ? ["--release"] : [])])
const hostBinary = resolve(repoRoot, "target", release ? "release" : "debug", process.platform === "win32" ? "xiranite-desktop.exe" : "xiranite-desktop")

const removedTemps = await clearStaleViteOptimizeTemps(viteCacheDir)
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
  env: viteDevelopmentEnvironment(viteMode),
})

let host: ManagedChild | null = null
let stopping = false

async function stop() {
  if (stopping) return
  stopping = true
  // The backend lives on a thread inside the host process, so stopping the host stops everything it
  // serves; there is no grandchild runtime to contain the way the Wails host needed a shutdown file.
  await Promise.all([stopProcessTree(vite), host ? stopProcessTree(host) : Promise.resolve()])
  await removeDevSession()
}

await writeDevSession({
  supervisorPid: process.pid,
  childPids: [vite.pid],
  script: "dev-desktop",
  startedAt: devSessionStartedAt,
  frontendUrl,
})
const stopRequestPoll = setInterval(() => {
  void consumeDevSessionStopRequest().then((requested) => { if (requested) void stop() })
}, 100)
stopRequestPoll.unref()
process.on("SIGINT", () => { void stop() })
process.on("SIGTERM", () => { void stop() })
process.on("exit", () => { void removeDevSession() })

try {
  console.log(formatFrontendWaitLog(frontendUrl, { profile: "desktop" }))
  const ready = await waitForFrontendReady(frontendUrl, { profile: "desktop", sinceMs: devSessionStartedAt })
  console.log(formatFrontendReadyLog(ready))

  const buildExitCode = await hostBuild
  if (buildExitCode !== 0) throw new Error(`cargo build -p xiranite-desktop exited with ${buildExitCode}`)

  // Release grants and the data directory stay the operator's environment: a dev supervisor that
  // silently widened the filesystem reach of the host would be the opposite of ADR-0073's model.
  host = spawnProcess([hostBinary], {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  })
  await writeDevSession({
    supervisorPid: process.pid,
    childPids: [vite.pid, host.pid],
    script: "dev-desktop",
    startedAt: devSessionStartedAt,
    frontendUrl,
  })

  const exitCode = await host.exited
  await stop()
  process.exit(exitCode ?? 0)
} catch (error) {
  await stop()
  console.error(error)
  process.exit(1)
}
