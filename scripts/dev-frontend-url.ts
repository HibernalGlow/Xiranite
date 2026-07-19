import { createServer } from "node:net"

const DEFAULT_FRONTEND_PORT = 5173
const MAX_PORT_ATTEMPTS = 100

export interface DevFrontendEnvironment {
  FRONTEND_DEVSERVER_URL?: string
  XIRANITE_FRONTEND_PORT?: string
}

export async function resolveManagedFrontendUrl(
  environment: DevFrontendEnvironment = Bun.env,
): Promise<string> {
  const configuredUrl = environment.FRONTEND_DEVSERVER_URL?.trim()
  if (configuredUrl) return new URL(configuredUrl).href.replace(/\/$/, "")

  const preferredPort = parsePreferredPort(environment.XIRANITE_FRONTEND_PORT)
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const port = preferredPort + offset
    if (port > 65_535) break
    if (await canListen("127.0.0.1", port)) return `http://127.0.0.1:${port}`
  }

  throw new Error(`No available frontend port found from ${preferredPort}.`)
}

function parsePreferredPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_FRONTEND_PORT
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("XIRANITE_FRONTEND_PORT must be an integer between 1 and 65535.")
  }
  return port
}

function canListen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once("error", () => resolve(false))
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}
