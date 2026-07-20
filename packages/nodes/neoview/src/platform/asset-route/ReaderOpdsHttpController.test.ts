import { describe, expect, it, vi } from "vitest"

import { ReaderOpdsHttpError, ReaderOpdsParseError } from "../opds/ReaderOpdsClient.js"
import { ReaderOpdsHttpController } from "./ReaderOpdsHttpController.js"

describe("ReaderOpdsHttpController", () => {
  it("[neoview.opds.http] exposes one encoded, no-store catalog request", async () => {
    const read = vi.fn(async () => ({
      url: "https://catalog.example/feed",
      title: "Catalog",
      navigation: [], publications: [], links: [],
    }))
    const controller = new ReaderOpdsHttpController({ read })
    const response = await controller.handle(request("/reader/opds/catalog?url=https%3A%2F%2Fcatalog.example%2Ffeed"))

    expect(response?.status).toBe(200)
    expect(response?.headers.get("cache-control")).toBe("no-store")
    await expect(response!.json()).resolves.toMatchObject({ title: "Catalog" })
    expect(read).toHaveBeenCalledWith("https://catalog.example/feed", expect.any(AbortSignal))
    expect((await controller.handle(request("/reader/opds/catalog")))?.status).toBe(400)
    expect((await controller.handle(request("/reader/opds/catalog", { method: "POST" })))?.status).toBe(405)
    expect((await controller.handle(request("/reader/opds/missing")))?.status).toBe(404)
    expect(await controller.handle(request("/other"))).toBeUndefined()
  })

  it("[neoview.opds.http-errors] preserves bounded upstream authentication evidence", async () => {
    const unauthorized = new ReaderOpdsHttpController({
      read: vi.fn(async () => { throw new ReaderOpdsHttpError(401, "Unauthorized", "Basic realm=books") }),
    })
    const response = (await unauthorized.handle(request("/reader/opds/catalog?url=https%3A%2F%2Fcatalog.example")))!
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ upstreamStatus: 401, authenticate: "Basic realm=books" })

    const malformed = new ReaderOpdsHttpController({
      read: vi.fn(async () => { throw new ReaderOpdsParseError("bad feed") }),
    })
    expect((await malformed.handle(request("/reader/opds/catalog?url=https%3A%2F%2Fcatalog.example")))?.status).toBe(422)
  })
})

function request(path: string, init?: RequestInit): Request {
  return new Request(`http://127.0.0.1:41000${path}`, init)
}
