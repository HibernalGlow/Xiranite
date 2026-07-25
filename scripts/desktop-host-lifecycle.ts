import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { stopProcessTree } from "./managed-process"

export const DEV_DESKTOP_SHUTDOWN_PATH_ENV = "XIRANITE_DEV_DESKTOP_SHUTDOWN_PATH"

type DesktopHostProcess = ReturnType<typeof Bun.spawn>

interface StopDesktopHostOptions {
  timeoutMs?: number
  forceStop?: (child: DesktopHostProcess) => Promise<void>
}

export function desktopHostShutdownPath(startedAt: number, supervisorPid = process.pid): string {
  return resolve(import.meta.dir, "..", ".cache", "xiranite-dev-sessions", `${supervisorPid}-${startedAt}.desktop-stop`)
}

export async function removeDesktopHostShutdownRequest(path: string): Promise<void> {
  await rm(path, { force: true })
}

export async function stopDesktopHost(
  child: DesktopHostProcess | null,
  shutdownPath: string,
  options: StopDesktopHostOptions = {},
): Promise<"already-exited" | "graceful" | "forced"> {
  if (!child || child.exitCode !== null) {
    await removeDesktopHostShutdownRequest(shutdownPath)
    return "already-exited"
  }

  const forceStop = options.forceStop ?? stopProcessTree
  try {
    await mkdir(dirname(shutdownPath), { recursive: true })
    await writeFile(shutdownPath, `${Date.now()}\n`, "utf8")
  } catch (error) {
    console.warn("[xiranite-desktop] unable to request graceful host shutdown; forcing process exit", error)
    await forceStop(child)
    await removeDesktopHostShutdownRequest(shutdownPath)
    return "forced"
  }

  const timeoutMs = options.timeoutMs ?? 5_000
  let timeout: ReturnType<typeof setTimeout> | undefined
  const exitedGracefully = await Promise.race([
    child.exited.then(() => true),
    new Promise<false>((resolveTimeout) => {
      timeout = setTimeout(() => resolveTimeout(false), timeoutMs)
    }),
  ])
  if (timeout) clearTimeout(timeout)
  if (!exitedGracefully) {
    console.warn(`[xiranite-desktop] host did not exit after ${timeoutMs}ms; forcing process exit`)
    await forceStop(child)
  }
  await removeDesktopHostShutdownRequest(shutdownPath)
  return exitedGracefully ? "graceful" : "forced"
}
