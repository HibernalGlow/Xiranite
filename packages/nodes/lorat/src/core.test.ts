import { describe, expect, test } from "vitest"
import type { LoratScannedModel } from "./core.js"
import { applyTriggerDb, buildLoratRows, collectTriggerDb, filterLoratRows, inferTrigger, runLorat } from "./core.js"

const scanned: LoratScannedModel[] = [
  {
    name: "@alice-style_step1200.safetensors",
    stem: "@alice-style_step1200",
    filePath: "D:/loras/@alice-style_step1200.safetensors",
    relativeDir: "",
    relativePath: "@alice-style_step1200.safetensors",
    pathParts: [],
    triggerText: null,
    noTriggerText: null,
    fileId: "a1",
  },
  {
    name: "quiet.pt",
    stem: "quiet",
    filePath: "D:/loras/self/quiet.pt",
    relativeDir: "self",
    relativePath: "self/quiet.pt",
    pathParts: ["self"],
    triggerText: "quiet token\n",
    noTriggerText: null,
    fileId: "b2",
  },
]

describe("lorat core", () => {
  test("infers triggers from filenames and folders", () => {
    expect(inferTrigger("@alice-style_step1200.safetensors", []).trigger).toBe("@alice-style")
    expect(inferTrigger("model-final.safetensors", ["artist", "@bob"])).toEqual({ trigger: "@bob", source: "folder @" })
    expect(inferTrigger("plain-v2.safetensors", ["artist", "Carol"]).trigger).toBe("Carol")
  })

  test("builds rows and applies TriggerDB matches", () => {
    const rows = buildLoratRows(scanned, {
      "self/quiet": { active_triggers: "json quiet" },
    })

    expect(rows).toHaveLength(2)
    expect(rows[0]?.status).toBe("missing")
    expect(rows[0]?.trigger).toBe("@alice-style")
    expect(rows[1]?.status).toBe("trigger")
    expect(rows[1]?.trigger).toBe("json quiet")
    expect(rows[1]?.dbKey).toBe("self/quiet")
  })

  test("filters rows and exports TriggerDB", () => {
    const rows = applyTriggerDb(buildLoratRows(scanned), { quiet: "short quiet" })
    const filtered = filterLoratRows(rows, { scopeFilter: "self", search: "quiet" })
    expect(filtered.map((row) => row.key)).toEqual(["self/quiet"])

    const db = collectTriggerDb(rows)
    expect(db.quiet).toMatchObject({ active_triggers: "short quiet", file_id: "b2" })
  })

  test("runs write action against selected rows", async () => {
    const rows = buildLoratRows(scanned).map((row) => row.key === "@alice-style_step1200" ? { ...row, selected: true } : row)
    const written: string[] = []
    const result = await runLorat(
      { action: "write_triggers", rows },
      {
        scanModels: async () => scanned,
        writeNoTrigger: async () => undefined,
        writeTrigger: async (row, trigger) => {
          written.push(`${row.key}:${trigger}`)
        },
      },
    )

    expect(result.success).toBe(true)
    expect(written).toEqual(["@alice-style_step1200:@alice-style"])
    expect(result.data?.rows[0]?.status).toBe("trigger")
  })
})
