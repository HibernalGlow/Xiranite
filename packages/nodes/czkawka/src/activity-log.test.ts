import { describe, expect, test } from "vitest"
import { appendCzkawkaActivityLog, filterCzkawkaActivityLog, formatCzkawkaActivityLogEntry, formatCzkawkaActivityMessage, serializeCzkawkaActivityLog } from "./activity-log.js"

describe("Czkawka activity log", () => {
  test("appends immutable bounded history", () => {
    const first = appendCzkawkaActivityLog([], { tool: "duplicate-files", kind: "scan", level: "info", message: "start", timestamp: 100 }, 2)
    const second = appendCzkawkaActivityLog(first, { tool: "duplicate-files", kind: "progress", level: "info", message: "hash", progress: 50, timestamp: 200 }, 2)
    const third = appendCzkawkaActivityLog(second, { tool: "duplicate-files", kind: "scan", level: "success", message: "done", timestamp: 300 }, 2)
    expect(first).toHaveLength(1)
    expect(third.map((entry) => entry.message)).toEqual(["hash", "done"])
  })

  test("filters all searchable fields", () => {
    const entries = [
      appendCzkawkaActivityLog([], { tool: "similar-images", kind: "progress", level: "info", message: "hashing", timestamp: 1 })[0]!,
      appendCzkawkaActivityLog([], { tool: "empty-files", kind: "operation", level: "error", action: "delete", message: "failed", timestamp: 2 })[0]!,
    ]
    expect(filterCzkawkaActivityLog(entries, "hash")).toHaveLength(1)
    expect(filterCzkawkaActivityLog(entries, "delete")).toHaveLength(1)
    expect(filterCzkawkaActivityLog(entries, "EMPTY")).toHaveLength(1)
  })

  test("uses one stable formatter for GUI CLI and TUI", () => {
    const entry = appendCzkawkaActivityLog([], { tool: "big-files", kind: "operation", level: "warning", action: "move", message: "partial", affectedCount: 3, errorCount: 1, timestamp: 0 })[0]!
    expect(formatCzkawkaActivityMessage("info", "scan", 42)).toBe("· [42%] scan")
    expect(formatCzkawkaActivityLogEntry(entry)).toContain("! partial · 3 affected / 1 errors")
    expect(serializeCzkawkaActivityLog([entry])).toContain("big-files · operation")
  })
})
