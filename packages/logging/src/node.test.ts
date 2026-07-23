import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createLogEnvelope, type LogResource, type LogSession } from "./schema.js"
import { discoverLogFiles, readLogDirectory, resolveLogDirectory, RotatingJsonlLogWriter } from "./node.js"

const tempDirectories: string[] = []
const resource: LogResource = { serviceName: "xiranite", processType: "test" }
const session: LogSession = { id: "session-writer", startedAt: "2026-07-23T00:00:00.000Z" }

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe("RotatingJsonlLogWriter", () => {
  it("writes strict JSONL through rotating-file-stream and reads it through the shared parser", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-logs-"))
    tempDirectories.push(directory)
    const writer = new RotatingJsonlLogWriter({ directory, source: "frontend", sessionId: session.id, size: "1M", compress: false })
    await writer.append([
      createLogEnvelope({ id: "event-one", timestamp: "2026-07-23T00:00:01.000Z", severityText: "info", eventName: "session.started", resource, scope: { name: "app" }, session }),
      createLogEnvelope({ id: "event-two", timestamp: "2026-07-23T00:00:02.000Z", severityText: "error", eventName: "reader.failed", resource, scope: { name: "neoview.reader" }, session, error: { name: "Error", message: "failed" } }),
    ])
    await writer.close()

    const files = await discoverLogFiles(directory)
    expect(files).toHaveLength(1)
    const text = await readFile(files[0]!, "utf8")
    expect(text.trim().split("\n")).toHaveLength(2)
    expect(text).not.toContain("---- session")
    const result = await readLogDirectory(directory)
    expect(result.issues).toEqual([])
    expect(result.events.map((event) => event.eventName)).toEqual(["session.started", "reader.failed"])
  })

  it("resolves the production log folder and environment override", () => {
    expect(resolveLogDirectory(undefined, { XIRANITE_LOG_DIR: "custom-logs" })).toBe(join(process.cwd(), "custom-logs"))
    expect(resolveLogDirectory()).toContain("logs")
  })
})
