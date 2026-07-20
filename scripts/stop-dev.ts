import { access } from "node:fs/promises"
import { DEV_SESSION_PATH, readDevSession, removeDevSession, requestDevSessionStop } from "./dev-session"

const session = await readDevSession()

if (!session) {
  console.log("[xiranite-dev] no managed development session is recorded.")
  process.exit(0)
}

await requestDevSessionStop()
console.log(`[xiranite-dev] requested a safe shutdown for ${session.script} (pid ${session.supervisorPid}).`)

for (let attempt = 0; attempt < 30; attempt += 1) {
  await Bun.sleep(100)
  try {
    await access(DEV_SESSION_PATH)
  } catch {
    console.log("[xiranite-dev] managed development session stopped.")
    process.exit(0)
  }
}

for (const pid of [...new Set([session.supervisorPid, ...session.childPids])]) {
  if (await isRecordedDevProcess(pid, session.startedAt)) await terminateProcessTree(pid)
}
await removeDevSession()
console.warn("[xiranite-dev] safe shutdown timed out; terminated the recorded Xiranite process tree.")

async function isRecordedDevProcess(pid: number, startedAt: number): Promise<boolean> {
  if (process.platform !== "win32") {
    const command = (await run(["ps", "-p", String(pid), "-o", "command="])).toLowerCase()
    return isDevCommand(command)
  }

  const script = `$p = Get-CimInstance Win32_Process -Filter \"ProcessId=${pid}\"; if ($p) { [pscustomobject]@{ command = $p.CommandLine; startedAt = [Management.ManagementDateTimeConverter]::ToDateTime($p.CreationDate).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress }`
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

async function run(command: string[]): Promise<string> {
  const process = Bun.spawn(command, { stdout: "pipe", stderr: "ignore" })
  const output = await new Response(process.stdout).text()
  await process.exited
  return output
}
