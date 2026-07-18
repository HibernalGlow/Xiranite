import { spawn } from "node:child_process"

export async function runXlchemyCommand(command: string, args: string[], isCancelled?: () => boolean) {
  return await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolveResult, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    const stdout: Buffer[] = [], stderr: Buffer[] = []
    let cancelled = false
    const cancelTimer = isCancelled ? setInterval(() => {
      if (!cancelled && isCancelled()) {
        cancelled = true
        terminateProcessTree(child.pid)
      }
    }, 50) : undefined
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.once("error", (error) => { if (cancelTimer) clearInterval(cancelTimer); reject(error) })
    child.once("close", (exitCode) => {
      if (cancelTimer) clearInterval(cancelTimer)
      resolveResult({ exitCode: cancelled ? 130 : exitCode ?? 1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: cancelled ? "Xlchemy command cancelled." : Buffer.concat(stderr).toString("utf8") })
    })
    if (isCancelled?.()) { cancelled = true; terminateProcessTree(child.pid) }
  })
}

function terminateProcessTree(pid: number | undefined) {
  if (!pid) return
  if (process.platform === "win32") {
    spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).unref()
    return
  }
  try { process.kill(pid, "SIGTERM") } catch { /* process already exited */ }
}
