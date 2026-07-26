import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./localBackendConfig", () => ({
  resolveLocalBackendConfig: () => ({ baseUrl: "http://127.0.0.1:5173", token: "test-token" }),
}))

import {
  isMelodeckDatabaseMissingFileError,
  loadMelodeckDatabaseMetadata,
  MelodeckDatabaseRequestError,
} from "./melodeckLibraryClient"

describe("Melo deck database client errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("classifies a missing local file without treating every 404 as ENOENT", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("ENOENT: no such file or directory", { status: 404 }))
      .mockResolvedValueOnce(new Response("route not found", { status: 404 }))

    const missing = await loadMelodeckDatabaseMetadata("E:/Music/deleted.flac").catch((error) => error)
    const route = await loadMelodeckDatabaseMetadata("E:/Music/present.flac").catch((error) => error)

    expect(missing).toBeInstanceOf(MelodeckDatabaseRequestError)
    expect(isMelodeckDatabaseMissingFileError(missing)).toBe(true)
    expect(route).toBeInstanceOf(MelodeckDatabaseRequestError)
    expect(isMelodeckDatabaseMissingFileError(route)).toBe(false)
  })
})
