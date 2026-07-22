import { createServer } from "node:net"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const DEFAULT_FRONTEND_PORT = 5173
const MAX_PORT_ATTEMPTS = 100
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export interface DevFrontendEnvironment {
  FRONTEND_DEVSERVER_URL?: string
  XIRANITE_FRONTEND_PORT?: string
}

export async function resolveManagedFrontendUrl(
  environment: DevFrontendEnvironment = Bun.env,
): Promise<string> {
  const configuredUrl = environment.FRONTEND_DEVSERVER_URL?.trim()
  if (configuredUrl) {
    const url = new URL(configuredUrl)
    const port = Number(url.port || (url.protocol === "https:" ? "443" : "80"))
    if (!(await canListen(url.hostname === "localhost" ? "127.0.0.1" : url.hostname, port))) {
      throw new Error(
        `FRONTEND_DEVSERVER_URL port ${port} is already in use. Stop the occupying process or unset FRONTEND_DEVSERVER_URL so XR can pick a free port.`,
      )
    }
    return url.href.replace(/\/$/, "")
  }

  const preferredPort = parsePreferredPort(environment.XIRANITE_FRONTEND_PORT)
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const port = preferredPort + offset
    if (port > 65_535) break
    if (await canListen("127.0.0.1", port)) return `http://127.0.0.1:${port}`
  }

  throw new Error(`No available frontend port found from ${preferredPort}.`)
}

/**
 * All managed development sessions share this cache. Vite's metadata already
 * invalidates it when the lockfile or dependency-optimization config changes.
 */
export function managedViteCacheDir(): string {
  return resolve(repoRoot, ".cache", "vite", "managed")
}

export function frontendPortFromUrl(frontendUrl: string): number {
  const frontend = new URL(frontendUrl)
  return Number(frontend.port || (frontend.protocol === "https:" ? "443" : "80"))
}

export async function waitForPortFree(
  host: string,
  port: number,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<boolean> {
  const attempts = options.attempts ?? 50
  const delayMs = options.delayMs ?? 100
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await canListen(host, port)) return true
    await Bun.sleep(delayMs)
  }
  return canListen(host, port)
}

export async function canListen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once("error", () => resolve(false))
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}

function parsePreferredPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_FRONTEND_PORT
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("XIRANITE_FRONTEND_PORT must be an integer between 1 and 65535.")
  }
  return port
}
