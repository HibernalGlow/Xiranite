import { consumeDevSessionStopRequest, removeDevSession, writeDevSession } from "./dev-session"
import { managedViteCacheDir, resolveManagedFrontendUrl } from "./dev-frontend-url"
import { spawnManagedVite, stopProcessTree } from "./managed-process"
import { viteDevelopmentEnvironment, type ViteDevelopmentMode } from "./vite-dev-environment"

const args = process.argv.slice(2)
const leanIndex = args.indexOf("--lean")
const mode: ViteDevelopmentMode = leanIndex === -1 ? "default" : "lean"
if (leanIndex !== -1) args.splice(leanIndex, 1)

const frontendUrl = await resolveManagedFrontendUrl()
const frontend = new URL(frontendUrl)
const viteArgs = [...args]
if (!hasOption(viteArgs, "--host")) viteArgs.push("--host", frontend.hostname)
if (!hasOption(viteArgs, "--port")) viteArgs.push("--port", frontend.port || "5173")
if (!viteArgs.includes("--strictPort")) viteArgs.push("--strictPort")

const vite = spawnManagedVite(viteArgs, {
  stdin: "ignore",
  stdout: "inherit",
  stderr: "inherit",
  env: viteDevelopmentEnvironment(mode, {
    ...Bun.env,
    VITE_XIRANITE_FRONTEND_DEV_URL: frontendUrl,
    XIRANITE_VITE_CACHE_DIR: managedViteCacheDir(frontendUrl),
  }),
})

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  await stopProcessTree(vite)
  await removeDevSession()
}

await writeDevSession({ supervisorPid: process.pid, childPids: [vite.pid], script: "dev:vite", startedAt: Date.now() })
const stopRequestPoll = setInterval(() => {
  void consumeDevSessionStopRequest().then((requested) => { if (requested) void stop() })
}, 100)
stopRequestPoll.unref()
process.on("SIGINT", () => { void stop() })
process.on("SIGTERM", () => { void stop() })
process.on("exit", () => { void removeDevSession() })

const exitCode = await vite.exited
await stop()
process.exit(exitCode ?? 0)

function hasOption(args: readonly string[], option: string): boolean {
  return args.some((arg) => arg === option || arg.startsWith(`${option}=`))
}
