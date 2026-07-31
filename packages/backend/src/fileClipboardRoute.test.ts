import { createMemoryWorkspaceRepository } from "@xiranite/repository"
import { describe, expect, test, vi } from "vitest"

import { startBackend } from "./index.js"

describe("native file clipboard route", () => {
  test("forwards the requested file drop effect and rejects unsupported effects", async () => {
    const writeClipboardFiles = vi.fn(async () => undefined)
    const backend = await startBackend({
      token: "test-token",
      repository: createMemoryWorkspaceRepository(),
      writeClipboardFiles,
    })
    try {
      const invalid = await postClipboard(backend.url, { paths: ["D:/Media/a.jpg"], effect: "link" })
      expect(invalid.status).toBe(400)

      const moved = await postClipboard(backend.url, { paths: ["D:/Media/a.jpg"], effect: "move" })
      expect(moved.status).toBe(200)
      expect(writeClipboardFiles).toHaveBeenCalledWith(["D:/Media/a.jpg"], "move")
    } finally {
      await backend.close()
    }
  })
})

function postClipboard(url: string, body: unknown): Promise<Response> {
  return fetch(`${url}/local-files/clipboard?token=test-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
