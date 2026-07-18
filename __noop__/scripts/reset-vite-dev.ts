import { rm } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const frontendUrl = Bun.env.FRONTEND_DEVSERVER_URL ?? `http://127.0.0.1:${Bun.env.XIRANITE_FRONTEND_PORT ?? "5173"}`
const frontend = new URL(frontendUrl)
const frontendPort = Number(frontend.port || (frontend.protocol === "https:" ? "443" : "80"))
const viteCacheDir = resolve(rootDir, "node_modules/.vite")

if (!viteCacheDir.startsWith(rootDir)) {
  throw new Error(`Refusing to clear unexpected Vite cache path: ${viteCacheDir}`)
}

await stopExistingVite(frontendPort)
await rm(viteCacheDir, { force: true, recursive: true })
console.log(`[xiranite-dev] cleared Vite optimize cache: ${viteCacheDir}`)

async function stopExistingVite(port: number) {
  if (!Number.isFinite(port)) return
  const listeners = process.platform === "win32"
    ? await windowsPortListeners(port)
    : await unixPortListeners(port)

  for (const listener of listeners) {
    if (listener.pid === process.pid) continue
    const command = await processCommand(listener.pid)
    if (!isWorkspaceViteProcess(command)) {
      console.warn(`[xiranite-dev] port ${port} is used by pid ${listener.pid}; leaving it alone.`)
      continue
    }

    try {
      process.kill(listener.pid)
      console.log(`[xiranite-dev] stopped stale Vite dev server on port ${port}: pid ${listener.pid}`)
    } catch (error) {
      console.warn(`[xiranite-dev] failed to stop pid ${listener.pid}:`, error)
    }
  }
}

async function windowsPortListeners(port: number): Promise<Array<{ pid: number }>> {
  const script = [
    `$connections = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue`,
    "$connections | Select-Object -ExpandProperty OwningProcess -Unique",
  ].join("; ")
  const result = await run(["powershell", "-NoProfile", "-Command", script])
  return result.stdout
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isFinite(pid) && pid > 0)
    .map((pid) => ({ pid }))
}

async function unixPortListeners(port: number): Promise<Array<{ pid: number }>> {
  const result = await run(["lsof", "-ti", `tcp:${port}`, "-sTCP:LISTEN"])
  return result.stdout
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isFinite(pid) && pid > 0)
    .map((pid) => ({ pid }))
}

async function processCommand(pid: number): Promise<string> {
  if (process.platform === "win32") {
    const result = await run([
      "powershell",
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -ExpandProperty CommandLine`,
    ])
    return result.stdout
  }

  const result = await run(["ps", "-p", String(pid), "-o", "command="])
  return result.stdout
}

function isWorkspaceViteProcess(command: string): boolean {
  const normalizedCommand = command.replace(/\\/g, "/").toLowerCase()
  const normalizedRoot = rootDir.replace(/\\/g, "/").toLowerCase()
  return normalizedCommand.includes("vite") && normalizedCommand.includes(normalizedRoot)
}

async function run(command: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode: exitCode ?? 0 }
}
