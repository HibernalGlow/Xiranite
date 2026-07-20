import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export interface DevSession {
  supervisorPid: number
  childPids: number[]
  script: string
  startedAt: number
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
export const DEV_SESSION_PATH = resolve(repoRoot, ".cache", "xiranite-dev-session.json")
export const DEV_STOP_REQUEST_PATH = resolve(repoRoot, ".cache", "xiranite-dev-stop.request")

export async function writeDevSession(session: DevSession): Promise<void> {
  await mkdir(dirname(DEV_SESSION_PATH), { recursive: true })
  await writeFile(DEV_SESSION_PATH, `${JSON.stringify(session, null, 2)}\n`, "utf8")
}

export async function readDevSession(): Promise<DevSession | null> {
  try {
    const value: unknown = JSON.parse(await readFile(DEV_SESSION_PATH, "utf8"))
    return isDevSession(value) ? value : null
  } catch {
    return null
  }
}

export async function removeDevSession(): Promise<void> {
  await Promise.all([rm(DEV_SESSION_PATH, { force: true }), rm(DEV_STOP_REQUEST_PATH, { force: true })])
}

export async function requestDevSessionStop(): Promise<void> {
  await mkdir(dirname(DEV_STOP_REQUEST_PATH), { recursive: true })
  await writeFile(DEV_STOP_REQUEST_PATH, `${Date.now()}\n`, "utf8")
}

export async function consumeDevSessionStopRequest(): Promise<boolean> {
  try {
    await rm(DEV_STOP_REQUEST_PATH)
    return true
  } catch {
    return false
  }
}

function isDevSession(value: unknown): value is DevSession {
  if (!value || typeof value !== "object") return false
  const session = value as Partial<DevSession>
  return Number.isInteger(session.supervisorPid)
    && Array.isArray(session.childPids)
    && session.childPids.every((pid) => Number.isInteger(pid))
    && typeof session.script === "string"
    && Number.isFinite(session.startedAt)
}
