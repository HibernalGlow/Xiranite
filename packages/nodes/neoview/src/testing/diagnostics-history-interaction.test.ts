import { describe, expect, it, vi } from "vitest"

import {
  createNeoviewDiagnosticsHistoryTuiDefinition,
  type NeoviewDiagnosticsHistoryTuiPort,
} from "../interaction.js"

describe("NeoView diagnostics history terminal interaction", () => {
  it("[neoview.diagnostics.history.tui] exports bounded remote history through the shared serializer", async () => {
    const port = { history: vi.fn(async () => history()) } satisfies NeoviewDiagnosticsHistoryTuiPort
    const definition = createNeoviewDiagnosticsHistoryTuiDefinition("en", port)

    await expect(definition.run({ format: "csv", sinceMs: -10, limit: 2 }, () => undefined)).resolves.toMatchObject({
      success: true,
      message: "Exported 1 diagnostics sample(s) as csv.",
    })
    expect(port.history).toHaveBeenCalledWith({ sinceMs: -10, limit: 2 })
    const result = await definition.run({ format: "json", limit: 1 }, () => undefined)
    expect(result.body).toContain('"droppedSamples":3')
    expect(definition.schema.validate({ format: "json", sinceMs: "bad", limit: 100 }, { format: "json", limit: 100 })).toContain("safe integer")
    expect(definition.schema.validate({ format: "json", sinceMs: "", limit: 1001 }, { format: "json", limit: 1001 })).toContain("between 1 and 1000")
  })
})

function history() {
  const pool = { active: 0, queued: 0, queuedByPriority: { interactive: 0, view: 0, ahead: 0, background: 0 } }
  return {
    schemaVersion: 1 as const,
    droppedSamples: 3,
    samples: [{
      schemaVersion: 1 as const,
      sampledAtMs: 10,
      uptimeSeconds: 5,
      process: { rssBytes: 8, heapTotalBytes: 7, heapUsedBytes: 6, externalBytes: 5, arrayBuffersBytes: 4, cpuUserMicros: 3, cpuSystemMicros: 2 },
      reader: { activeSessions: 0 },
      assets: { activeTransformFlights: 0, presentation: null, thumbnails: null },
      presentationDiskCache: { enabled: false },
      solidArchiveCache: { entries: 0, retainedBytes: 0, maxBytes: 0 },
      scheduler: { cpu: pool, io: pool, gpu: pool },
    }],
  }
}
