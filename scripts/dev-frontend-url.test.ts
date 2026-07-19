import { createServer } from "node:net"
import { afterEach, describe, expect, it } from "bun:test"

import { resolveManagedFrontendUrl } from "./dev-frontend-url"

const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe("resolveManagedFrontendUrl", () => {
  it("preserves an explicit frontend URL", async () => {
    await expect(resolveManagedFrontendUrl({
      FRONTEND_DEVSERVER_URL: "http://localhost:6123/",
      XIRANITE_FRONTEND_PORT: "5173",
    })).resolves.toBe("http://localhost:6123")
  })

  it("advances past consecutive occupied ports", async () => {
    const occupiedPort = await occupyConsecutivePorts(2)
    const resolved = new URL(await resolveManagedFrontendUrl({
      XIRANITE_FRONTEND_PORT: String(occupiedPort),
    }))

    expect(Number(resolved.port)).toBeGreaterThan(occupiedPort + 1)
  })

  it("rejects an invalid preferred port", async () => {
    await expect(resolveManagedFrontendUrl({ XIRANITE_FRONTEND_PORT: "invalid" })).rejects.toThrow(
      "XIRANITE_FRONTEND_PORT",
    )
  })
})

async function occupyConsecutivePorts(count: number): Promise<number> {
  for (let basePort = 61_000; basePort <= 65_535 - count; basePort += count) {
    const attempt: ReturnType<typeof createServer>[] = []
    try {
      for (let offset = 0; offset < count; offset += 1) {
        const server = createServer()
        attempt.push(server)
        await listen(server, basePort + offset)
      }
      servers.push(...attempt)
      return basePort
    } catch {
      await Promise.all(attempt.map(close))
    }
  }
  throw new Error(`Could not reserve ${count} consecutive test ports.`)
}

function listen(server: ReturnType<typeof createServer>, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve)
  })
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}
