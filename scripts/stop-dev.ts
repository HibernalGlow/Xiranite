import { frontendPortFromUrl, waitForPortFree } from "./dev-frontend-url"
import { readDevSession, removeDevSession, requestDevSessionStop } from "./dev-session"

const session = await readDevSession()

if (!session) {
  console.log("[Xiranite 开发] 当前没有受管开发会话。")
  process.exit(0)
}

const recordedPids = [...new Set([session.supervisorPid, ...session.childPids])]
const frontendUrl = session.frontendUrl
const frontendPort = frontendUrl ? frontendPortFromUrl(frontendUrl) : undefined
const host = frontendUrl ? new URL(frontendUrl).hostname === "localhost" ? "127.0.0.1" : new URL(frontendUrl).hostname : "127.0.0.1"

// TUI launcher sessions do not poll the soft-stop request; kill their tree now so
// reboot/start cannot race a half-built `bun run dev` process.
if (session.script.startsWith("dev-ui:")) {
  console.log(`[Xiranite 开发] 正在终止 TUI 启动器（进程号 ${session.supervisorPid}）。`)
  for (const pid of recordedPids) await terminateProcessTree(pid)
} else {
  await requestDevSessionStop()
  console.log(`[Xiranite 开发] 已请求安全停止${session.script.includes("desktop") ? "桌面" : "浏览器"}开发宿主（进程号 ${session.supervisorPid}）。`)

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

if (frontendPort !== undefined) {
  await freeFrontendPort(host, frontendPort)
}

if (await anyRecordedProcessAlive(recordedPids)) {
  await removeDevSession()
  console.warn("[Xiranite 开发] 停止超时；已终止记录的 Xiranite 进程树，但未能确认所有 PID 退出。")
  process.exit(1)
}

await removeDevSession()
console.log("[Xiranite 开发] 受管开发会话已停止。")
process.exit(0)

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
