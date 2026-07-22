import { consumeDevSessionStopRequest, removeDevSession, writeDevSession } from "./dev-session"
import { managedViteCacheDir, resolveManagedFrontendUrl } from "./dev-frontend-url"
import { waitForFrontendReady } from "./frontend-readiness"
import { clearStaleViteOptimizeTemps, spawnManagedVite, stopProcessTree } from "./managed-process"
import { viteDevelopmentEnvironment, type ViteDevelopmentMode } from "./vite-dev-environment"

const args = process.argv.slice(2)
const leanIndex = args.indexOf("--lean")
const mode: ViteDevelopmentMode = leanIndex === -1 ? "default" : "lean"
if (leanIndex !== -1) args.splice(leanIndex, 1)

const frontend = new URL(await resolveManagedFrontendUrl())
const viteArgs = [...args]
const hostOverride = readOption(viteArgs, "--host")
const portOverride = readOption(viteArgs, "--port")
if (hostOverride) frontend.hostname = hostOverride
if (portOverride) frontend.port = portOverride
if (!hasOption(viteArgs, "--host")) viteArgs.push("--host", frontend.hostname)
if (!hasOption(viteArgs, "--port")) viteArgs.push("--port", frontend.port || "5173")
if (!viteArgs.includes("--strictPort")) viteArgs.push("--strictPort")

// Always keep the HMR/client URL aligned with the actual Vite bind address.
// A mismatched VITE_XIRANITE_FRONTEND_DEV_URL used to open a second websocket
// listener (often on 5173/5174) that answered document GETs with 426/404.
const frontendUrl = frontend.href.replace(/\/$/, "")

const removedTemps = await clearStaleViteOptimizeTemps()
if (removedTemps > 0) console.log(`[xiranite-frontend] cleared ${removedTemps} stale Vite optimize temp(s)`)

const vite = spawnManagedVite(viteArgs, {
  stdin: "ignore",
  stdout: "inherit",
  stderr: "inherit",
  env: viteDevelopmentEnvironment(mode, {
    ...Bun.env,
    VITE_XIRANITE_FRONTEND_DEV_URL: frontendUrl,
    XIRANITE_VITE_CACHE_DIR: managedViteCacheDir(),
  }),
})

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  await stopProcessTree(vite)
  await removeDevSession()
}

await writeDevSession({
  supervisorPid: process.pid,
  childPids: [vite.pid],
  script: "dev:vite",
  startedAt: Date.now(),
  frontendUrl,
})
const stopRequestPoll = setInterval(() => {
  void consumeDevSessionStopRequest().then((requested) => { if (requested) void stop() })
}, 100)
stopRequestPoll.unref()
process.on("SIGINT", () => { void stop() })
process.on("SIGTERM", () => { void stop() })
process.on("exit", () => { void removeDevSession() })

console.log(`[xiranite-frontend] ${frontendUrl}`)
void waitForFrontendReady(frontendUrl).then(() => {
  console.log(`[xiranite-frontend:ready] ${frontendUrl}`)
}).catch((error: unknown) => {
  if (!stopping) console.error(`[xiranite-frontend:not-ready] ${error instanceof Error ? error.message : String(error)}`)
})

const exitCode = await vite.exited
await stop()
process.exit(exitCode ?? 0)

function hasOption(args: readonly string[], option: string): boolean {
  return args.some((arg) => arg === option || arg.startsWith(`${option}=`))
}

function readOption(args: readonly string[], option: string): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === option) return args[index + 1]
    if (arg.startsWith(`${option}=`)) return arg.slice(option.length + 1)
  }
  return undefined
}
