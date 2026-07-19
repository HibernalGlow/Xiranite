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

  it("advances past an occupied preferred port", async () => {
    const occupiedPort = await occupyAvailablePort()
    const resolved = new URL(await resolveManagedFrontendUrl({
      XIRANITE_FRONTEND_PORT: String(occupiedPort),
    }))

    expect(Number(resolved.port)).toBeGreaterThan(occupiedPort)
  })

  it("rejects an invalid preferred port", async () => {
    await expect(resolveManagedFrontendUrl({ XIRANITE_FRONTEND_PORT: "invalid" })).rejects.toThrow(
      "XIRANITE_FRONTEND_PORT",
    )
  })
})

async function occupyAvailablePort(): Promise<number> {
  const server = createServer()
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Expected a TCP test address.")
  return address.port
}
