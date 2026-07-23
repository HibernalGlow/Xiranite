import { describe, expect, it } from "vitest"
import { createLogEnvelope, createLogSession } from "@xiranite/logging"
import { createLogxTelemetry, runLogx, summarizeLogxSessions, type LogxRuntime } from "./core.js"

const session = createLogSession("2026-07-23T00:00:00.000Z")
const events = [
  createLogEnvelope({ id: "one", timestamp: "2026-07-23T00:00:01.000Z", severityText: "info", eventName: "app.started", resource: { serviceName: "xiranite", processType: "frontend" }, scope: { name: "app" }, session }),
  createLogEnvelope({ id: "two", timestamp: "2026-07-23T00:00:02.000Z", severityText: "error", eventName: "reader.failed", body: "decode failed", resource: { serviceName: "xiranite", processType: "backend" }, scope: { name: "neoview.reader" }, session, error: { name: "DecodeError", message: "decode failed" } }),
]
const runtime: LogxRuntime = { read: async () => ({ directory: "D:/logs", files: ["D:/logs/current.jsonl"], events, issues: [] }) }

describe("LogX core", () => {
  it("uses the shared structured query and aggregate model", async () => {
    const result = await runLogx({ minimumSeverity: "warn", scope: "neoview", search: "decode" }, runtime)
    expect(result.success).toBe(true)
    expect(result.data?.events.map((event) => event.id)).toEqual(["two"])
    expect(result.data?.aggregate.bySeverity).toEqual({ error: 1 })
    expect(result.data?.sessions[0]).toMatchObject({ eventCount: 1, errorCount: 1, processTypes: ["backend"] })
    expect(result.data?.telemetry).toMatchObject({ eventsPerSecond: 1, stormIntensity: expect.any(Number) })
  })

  it("summarizes session resources without duplicating values", () => {
    expect(summarizeLogxSessions(events)[0]).toMatchObject({ eventCount: 2, errorCount: 1, processTypes: ["backend", "frontend"], scopes: ["app", "neoview.reader"] })
  })

  it("builds a normalized 16-bucket anomaly map", () => {
    const telemetry = createLogxTelemetry(events)
    expect(telemetry.durationMs).toBe(1_000)
    expect(telemetry.eventsPerSecond).toBe(2)
    expect(telemetry.anomalyCells).toHaveLength(16)
    expect(telemetry.anomalyCells[15]).toMatchObject({ eventCount: 1, intensity: 1 })
  })
})
