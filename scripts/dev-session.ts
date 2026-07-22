import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export interface DevSession {
  supervisorPid: number
  childPids: number[]
  script: string
  startedAt: number
  /** Authoritative browser URL for this session (includes the real Vite port). */
  frontendUrl?: string
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
export const DEV_SESSION_PATH = resolve(repoRoot, ".cache", "xiranite-dev-session.json")
export const DEV_SESSIONS_DIR = resolve(repoRoot, ".cache", "xiranite-dev-sessions")

export async function writeDevSession(session: DevSession): Promise<void> {
  await mkdir(DEV_SESSIONS_DIR, { recursive: true })
  const contents = `${JSON.stringify(session, null, 2)}\n`
  await Promise.all([
    writeFile(devSessionPath(session.supervisorPid), contents, "utf8"),
    // Keep the latest-session pointer for compatibility with older tooling.
    writeFile(DEV_SESSION_PATH, contents, "utf8"),
  ])
}

export async function readDevSession(): Promise<DevSession | null> {
  const sessions = await readDevSessions()
  return sessions.sort((left, right) => right.startedAt - left.startedAt)[0] ?? null
}

export async function readDevSessions(): Promise<DevSession[]> {
  const sessions: DevSession[] = []
  try {
    const entries = await readdir(DEV_SESSIONS_DIR)
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue
      const session = await readSessionFile(resolve(DEV_SESSIONS_DIR, entry))
      if (session) sessions.push(session)
    }
  } catch { /* No per-supervisor session directory yet. */ }

  const legacy = await readSessionFile(DEV_SESSION_PATH)
  if (legacy && !sessions.some((session) => session.supervisorPid === legacy.supervisorPid)) {
    sessions.push(legacy)
  }
  return sessions
}

export async function removeDevSession(supervisorPid = process.pid): Promise<void> {
  await Promise.all([
    rm(devSessionPath(supervisorPid), { force: true }),
    rm(devStopRequestPath(supervisorPid), { force: true }),
  ])
  const latest = await readSessionFile(DEV_SESSION_PATH)
  if (latest?.supervisorPid === supervisorPid) await rm(DEV_SESSION_PATH, { force: true })
}

export async function requestDevSessionStop(supervisorPid: number): Promise<void> {
  await mkdir(DEV_SESSIONS_DIR, { recursive: true })
  await writeFile(devStopRequestPath(supervisorPid), `${Date.now()}\n`, "utf8")
}

export async function consumeDevSessionStopRequest(supervisorPid = process.pid): Promise<boolean> {
  try {
    await rm(devStopRequestPath(supervisorPid))
    return true
  } catch {
    return false
  }
}

export function devSessionPath(supervisorPid: number): string {
  return resolve(DEV_SESSIONS_DIR, `${supervisorPid}.json`)
}

export function devStopRequestPath(supervisorPid: number): string {
  return resolve(DEV_SESSIONS_DIR, `${supervisorPid}.stop`)
}

async function readSessionFile(path: string): Promise<DevSession | null> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"))
    return isDevSession(value) ? value : null
  } catch {
    return null
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
    && (session.frontendUrl === undefined || typeof session.frontendUrl === "string")
}
