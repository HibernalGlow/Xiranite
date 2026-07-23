/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { expect, test } from "bun:test"
import { createLogEnvelope, createLogSession } from "@xiranite/logging"
import { createLogxInteractionSchema } from "./interaction.js"
import { LogxTui } from "./Tui.js"

test("LogX OpenTUI renders query controls and shared results", async () => {
  const session = createLogSession()
  const event = createLogEnvelope({ severityText: "error", eventName: "reader.failed", resource: { serviceName: "xiranite", processType: "frontend" }, scope: { name: "neoview.reader" }, session, error: { name: "Error", message: "decode failed" } })
  const definition = { schema: createLogxInteractionSchema({}, "en"), run: async () => ({ success: true, message: "ok", data: { action: "query" as const, directory: "D:/logs", files: [], issues: [], matchedCount: 1, returnedCount: 1, events: [event], aggregate: { total: 1, bySeverity: { error: 1 }, byScope: { "neoview.reader": 1 }, byEvent: { "reader.failed": 1 }, bySession: { [session.id]: 1 }, errors: [] }, sessions: [] } }) }
  const view = await testRender(<LogxTui definition={definition} language="en" onExit={() => undefined} />, { width: 150, height: 40 })
  try {
    await act(async () => view.renderOnce())
    const frame = view.captureCharFrame()
    expect(frame).toContain("LOGX // STRUCTURED LOG WORKBENCH")
    expect(frame).toContain("STRUCTURED FILTERS")
    expect(frame).toContain("EVENT STREAM")
  } finally {
    await act(async () => view.renderer.destroy())
  }
})
