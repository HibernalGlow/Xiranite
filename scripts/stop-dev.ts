import { frontendPortFromUrl, waitForPortFree } from "./dev-frontend-url"
import { readDevSessions, removeDevSession, requestDevSessionStop, type DevSession } from "./dev-session"

const sessions = await readDevSessions()

if (sessions.length === 0) {
  console.log("[Xiranite dev] No managed development sessions are active.")
  process.exit(0)
}

let failed = false
for (const session of sessions) {
  if (!(await stopSession(session))) failed = true
}

console.log(`[Xiranite dev] Stopped ${sessions.length} managed development session(s).`)
process.exit(failed ? 1 : 0)

async function stopSession(session: DevSession): Promise<boolean> {
  const recordedPids = [...new Set([session.supervisorPid, ...session.childPids])]
  const frontendUrl = session.frontendUrl

  if (session.script.startsWith("dev-ui:")) {
    for (const pid of recordedPids) await terminateProcessTree(pid)
  } else {
    await requestDevSessionStop(session.supervisorPid)
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await Bun.sleep(100)
      if (!(await anyRecordedProcessAlive(recordedPids))) break
    }

    if (await anyRecordedProcessAlive(recordedPids)) {
      for (const pid of recordedPids) {
        if (await isRecordedDevProcess(pid, session.startedAt)) await terminateProcessTree(pid)
      }
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await Bun.sleep(100)
        if (!(await anyRecordedProcessAlive(recordedPids))) break
      }
    }
  }

  if (frontendUrl) {
    const frontend = new URL(frontendUrl)
    const host = frontend.hostname === "localhost" ? "127.0.0.1" : frontend.hostname
    await freeFrontendPort(host, frontendPortFromUrl(frontendUrl))
  }

  const alive = await anyRecordedProcessAlive(recordedPids)
  await removeDevSession(session.supervisorPid)
  if (alive) console.warn(`[Xiranite dev] Could not confirm session ${session.supervisorPid} exited.`)
  return !alive
}

async function freeFrontendPort(bindHost: string, port: number): Promise<void> {
  if (await waitForPortFree(bindHost, port, { attempts: 20, delayMs: 100 })) return

  const listenerPids = await listPortListenerPids(port)
  for (const pid of listenerPids) {
    if (await isDevCommandForPid(pid)) {
      console.warn(`[Xiranite 开发] 正在释放仍占用前端端口 ${port} 的开发进程（进程号 ${pid}）。`)
      await terminateProcessTree(pid)
    }
  }

  if (!(await waitForPortFree(bindHost, port, { attempts: 30, delayMs: 100 }))) {
    console.warn(`[Xiranite 开发] 前端端口 ${port} 仍被占用；下一次启动可能会改用其它端口。`)
  }
}

async function isRecordedDevProcess(pid: number, startedAt: number): Promise<boolean> {
  if (process.platform !== "win32") {
    const command = (await run(["ps", "-p", String(pid), "-o", "command="])).toLowerCase()
    return isDevCommand(command)
  }

  const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { [pscustomobject]@{ command = $p.CommandLine; startedAt = [Management.ManagementDateTimeConverter]::ToDateTime($p.CreationDate).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress }`
  try {
    const processInfo = JSON.parse(await run(["powershell", "-NoProfile", "-Command", script])) as { command?: unknown, startedAt?: unknown }
    const command = typeof processInfo.command === "string" ? processInfo.command.toLowerCase() : ""
    const actualStartedAt = typeof processInfo.startedAt === "string" ? Date.parse(processInfo.startedAt) : Number.NaN
    return isDevCommand(command)
      && Number.isFinite(actualStartedAt)
      && Math.abs(actualStartedAt - startedAt) < 30_000
  } catch {
    return false
  }
}

async function isDevCommandForPid(pid: number): Promise<boolean> {
  if (process.platform !== "win32") {
    const command = (await run(["ps", "-p", String(pid), "-o", "command="])).toLowerCase()
    return isDevCommand(command)
  }
  const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { $p.CommandLine }`
  try {
    return isDevCommand((await run(["powershell", "-NoProfile", "-Command", script])).toLowerCase())
  } catch {
    return false
  }
}

function isDevCommand(command: string): boolean {
  return command.includes("dev-with-backend")
    || command.includes("dev-desktop")
    || command.includes("run-vite-dev")
    || command.includes("vite")
    || command.includes("run dev")
}

async function terminateProcessTree(pid: number): Promise<void> {
  if (process.platform === "win32") await run(["taskkill", "/PID", String(pid), "/T", "/F"])
  else try { process.kill(pid, "SIGTERM") } catch { /* Already exited. */ }
}

async function anyRecordedProcessAlive(pids: readonly number[]): Promise<boolean> {
  return pids.some((pid) => isProcessAlive(pid))
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function listPortListenerPids(port: number): Promise<number[]> {
  if (process.platform === "win32") {
    const script = `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ConvertTo-Json -Compress`
    try {
      const raw = (await run(["powershell", "-NoProfile", "-Command", script])).trim()
      if (!raw) return []
      const parsed: unknown = JSON.parse(raw)
      const values = Array.isArray(parsed) ? parsed : [parsed]
      return values.map(Number).filter((pid) => Number.isInteger(pid) && pid > 0)
    } catch {
      return []
    }
  }

  try {
    const output = await run(["lsof", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])
    return [...new Set(output.split(/\s+/).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0))]
  } catch {
    return []
  }
}

async function run(command: string[]): Promise<string> {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "ignore" })
  const output = await new Response(child.stdout).text()
  await child.exited
  return output
}
