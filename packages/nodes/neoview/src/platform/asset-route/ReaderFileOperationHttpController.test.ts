import { describe, expect, it, vi } from "vitest"

import { ReaderFileOperationService } from "../../application/files/ReaderFileOperationService.js"
import { ReaderFileOperationHttpController } from "./ReaderFileOperationHttpController.js"

describe("ReaderFileOperationHttpController", () => {
  it("[neoview.file-operations.http] lazily executes a validated batch", async () => {
    const execute = vi.fn(async () => undefined)
    const load = vi.fn(async () => new ReaderFileOperationService({ execute }))
    const controller = new ReaderFileOperationHttpController(load)
    const path = absolute("source.jpg")
    const response = await controller.handle(jsonRequest({ operations: [{ kind: "trash", sourcePath: path }], confirmed: true }))

    expect(response?.status).toBe(200)
    expect(await response?.json()).toMatchObject({ succeeded: 1, failed: 0, cancelled: 0 })
    expect(load).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith({ kind: "trash", sourcePath: path }, expect.any(AbortSignal))
  })

  it("[neoview.file-operations.confirmation] rejects destructive work before loading the platform adapter", async () => {
    const load = vi.fn(async () => new ReaderFileOperationService({ execute: vi.fn() }))
    const controller = new ReaderFileOperationHttpController(load)
    const response = await controller.handle(jsonRequest({ operations: [{ kind: "delete", sourcePath: absolute("source.jpg") }] }))

    expect(response?.status).toBe(409)
    expect(load).not.toHaveBeenCalled()
  })

  it("[neoview.file-operations.http-validation] rejects invalid kinds and methods", async () => {
    const controller = new ReaderFileOperationHttpController(async () => new ReaderFileOperationService({ execute: vi.fn() }))
    const invalid = await controller.handle(jsonRequest({ operations: [{ kind: "unknown", sourcePath: absolute("source.jpg") }] }))
    const method = await controller.handle(new Request("http://127.0.0.1/reader/files/operations"))

    expect(invalid?.status).toBe(400)
    expect(method?.status).toBe(405)
    expect(method?.headers.get("allow")).toBe("POST")
  })
})

function jsonRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/reader/files/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function absolute(path: string): string {
  return process.platform === "win32" ? `C:\\reader-test\\${path}` : `/reader-test/${path}`
}
