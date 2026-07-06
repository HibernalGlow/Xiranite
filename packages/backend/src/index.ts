import { createXiraniteApp } from "@xiranite/api"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"
import { createXiraniteServices } from "@xiranite/services"

export interface CreateDefaultBackendOptions {
  now?: number
}

export interface StartBackendOptions extends CreateDefaultBackendOptions {
  hostname?: string
  port?: number
  token?: string
}

export function createDefaultBackendApp(options: CreateDefaultBackendOptions = {}) {
  const now = options.now ?? Date.now()
  const repository = createMemoryWorkspaceRepository({
    workspaces: [
      {
        id: "ws-default",
        label: "Default",
        createdAt: now,
        updatedAt: now,
      },
    ],
  })

  return createXiraniteApp(createXiraniteServices(repository))
}

export function startBackend(options: StartBackendOptions = {}) {
  const app = createDefaultBackendApp(options)
  const hostname = options.hostname ?? "127.0.0.1"
  const token = options.token ?? randomToken()
  const server = Bun.serve({
    hostname,
    port: options.port ?? 0,
    fetch: (request) => {
      const url = new URL(request.url)
      if (url.pathname !== "/health" && request.headers.get("x-xiranite-token") !== token) {
        return new Response("Unauthorized", { status: 401 })
      }

      return app.handle(request)
    },
  })

  return {
    server,
    hostname,
    port: server.port,
    url: `http://${hostname}:${server.port}`,
    token,
  }
}

function randomToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

if (import.meta.main) {
  const backend = startBackend()
  console.log(JSON.stringify({ url: backend.url, token: backend.token }))
}
