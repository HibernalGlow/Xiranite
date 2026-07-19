import { describe, expect, it, vi } from "vitest"

import { fetchRemoteReaderDiagnosticsHistory } from "./RemoteReaderHeadlessController.js"

describe("fetchRemoteReaderDiagnosticsHistory", () => {
  it("[neoview.diagnostics.history-cli-connect] reads authenticated bounded history without opening a Reader session", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      schemaVersion: 1,
      samples: [{ ...diagnosticsSnapshot(), future: { metric: 7 } }],
      droppedSamples: 3,
    }), { headers: { "content-type": "application/json" } }))

    const history = await fetchRemoteReaderDiagnosticsHistory({
      baseUrl: "http://127.0.0.1:41000",
      token: "diagnostics-token",
      sinceMs: -10,
      limit: 12,
      fetch: fetchMock,
    })

    expect(history).toMatchObject({ schemaVersion: 1, droppedSamples: 3, samples: [expect.objectContaining({ future: { metric: 7 } })] })
    const request = new Request(fetchMock.mock.calls[0]![0], fetchMock.mock.calls[0]![1])
    expect(request.url).toBe("http://127.0.0.1:41000/reader/diagnostics/history?sinceMs=-10&limit=12")
    expect(request.headers.get("x-xiranite-token")).toBe("diagnostics-token")
  })

  it("[neoview.diagnostics.history-cli-connect-bounds] rejects unsafe query values before calling the backend", async () => {
    const fetchMock = vi.fn()
    await expect(fetchRemoteReaderDiagnosticsHistory({
      baseUrl: "http://127.0.0.1:41000",
      token: "diagnostics-token",
      limit: 0,
      fetch: fetchMock,
    })).rejects.toThrow("between 1 and 1000")
    await expect(fetchRemoteReaderDiagnosticsHistory({
      baseUrl: "http://127.0.0.1:41000",
      token: "diagnostics-token",
      sinceMs: Number.NaN,
      fetch: fetchMock,
    })).rejects.toThrow("safe integer")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("[neoview.diagnostics.history-wire-schema] rejects malformed history from the running backend", async () => {
    await expect(fetchRemoteReaderDiagnosticsHistory({
      baseUrl: "http://127.0.0.1:41000",
      token: "diagnostics-token",
      fetch: async () => new Response(JSON.stringify({ schemaVersion: 1, samples: [{ ...diagnosticsSnapshot(), process: { rssBytes: -1 } }], droppedSamples: 0 }), {
        headers: { "content-type": "application/json" },
      }),
    })).rejects.toThrow("invalid diagnostics history response")
  })
})

function diagnosticsSnapshot() {
  const pool = { active: 2, queued: 1, queuedByPriority: { interactive: 0, view: 0, ahead: 1, background: 0 } }
  return {
    schemaVersion: 1,
    sampledAtMs: 10,
    uptimeSeconds: 5,
    process: { rssBytes: 8, heapTotalBytes: 7, heapUsedBytes: 6, externalBytes: 5, arrayBuffersBytes: 4, cpuUserMicros: 3, cpuSystemMicros: 2 },
    reader: { activeSessions: 3 },
    assets: { activeTransformFlights: 0, presentation: null, thumbnails: null },
    presentationDiskCache: { enabled: false },
    solidArchiveCache: { entries: 0, retainedBytes: 0, maxBytes: 0 },
    scheduler: { cpu: pool, io: pool, gpu: pool },
  }
}
