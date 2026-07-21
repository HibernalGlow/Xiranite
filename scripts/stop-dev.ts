import { readDevSession, removeDevSession, requestDevSessionStop } from "./dev-session"

const session = await readDevSession()

if (!session) {
  console.log("[Xiranite 开发] 当前没有受管开发会话。")
  process.exit(0)
}

await requestDevSessionStop()
console.log(`[Xiranite 开发] 已请求安全停止${session.script.includes("desktop") ? "桌面" : "浏览器"}开发宿主（进程号 ${session.supervisorPid}）。`)

const recordedPids = [...new Set([session.supervisorPid, ...session.childPids])]
for (let attempt = 0; attempt < 100; attempt += 1) {
  await Bun.sleep(100)
  if (!(await anyRecordedProcessAlive(recordedPids))) {
    await removeDevSession()
    console.log("[Xiranite 开发] 受管开发会话已停止。")
    process.exit(0)
  }
}

for (const pid of recordedPids) {
  if (await isRecordedDevProcess(pid, session.startedAt)) await terminateProcessTree(pid)
}

for (let attempt = 0; attempt < 50; attempt += 1) {
  await Bun.sleep(100)
  if (!(await anyRecordedProcessAlive(recordedPids))) {
    await removeDevSession()
    console.warn("[Xiranite 开发] 安全停止超时，已终止并确认开发进程树退出。")
    process.exit(0)
  }
}

await removeDevSession()
console.warn("[Xiranite 开发] 停止超时；已终止记录的 Xiranite 进程树，但未能确认所有 PID 退出。")

async function isRecordedDevProcess(pid: number, startedAt: number): Promise<boolean> {
  if (process.platform !== "win32") {
    const command = (await run(["ps", "-p", String(pid), "-o", "command="])).toLowerCase()
    return isDevCommand(command)
  }

  const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { [pscustomobject]@{ command = $p.CommandLine; startedAt = [Management.ManagementDateTimeConverter]::ToDateTime($p.CreationDate).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress }`
  try {
    const process = JSON.parse(await run(["powershell", "-NoProfile", "-Command", script])) as { command?: unknown, startedAt?: unknown }
    const command = typeof process.command === "string" ? process.command.toLowerCase() : ""
    const actualStartedAt = typeof process.startedAt === "string" ? Date.parse(process.startedAt) : Number.NaN
    return isDevCommand(command)
      && Number.isFinite(actualStartedAt)
      && Math.abs(actualStartedAt - startedAt) < 30_000
  } catch {
    return false
  }
}

function isDevCommand(command: string): boolean {
  return command.includes("dev-with-backend")
    || command.includes("dev-desktop")
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

async function run(command: string[]): Promise<string> {
  const process = Bun.spawn(command, { stdout: "pipe", stderr: "ignore" })
  const output = await new Response(process.stdout).text()
  await process.exited
  return output
}
