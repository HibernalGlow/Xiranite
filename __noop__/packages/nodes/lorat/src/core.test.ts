import { describe, expect, test } from "vitest"
import type { LoratScannedModel } from "./core.js"
import { applyTriggerDb, buildLoratRows, collectLoratModels, collectTriggerDb, filterLoratRows, inferTrigger, runLorat, suggestCollectionRelativeDir } from "./core.js"

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
        copyFile: async () => undefined,
        fileExists: async () => false,
        joinPath: (...parts) => parts.join("/"),
        basename: (path) => path.split("/").at(-1) ?? path,
        extname: (path) => path.slice(path.lastIndexOf(".")),
      },
    )

    expect(result.success).toBe(true)
    expect(written).toEqual(["@alice-style_step1200:@alice-style"])
    expect(result.data?.rows[0]?.status).toBe("trigger")
  })

  test("collects a LoRA, preview image, and trigger sidecar inside the selected library root", async () => {
    const copied: string[] = []
    const triggers: string[] = []
    const result = await collectLoratModels({
      collectionRoot: "D:/ComfyUI/models/loras",
      collectionItems: [{
        sourcePath: "D:/Downloads/neon_mecha_v2.safetensors",
        previewSourcePath: "D:/Downloads/neon_mecha.png",
        targetRelativeDir: "style/mecha",
        triggerText: "neon_mecha, glowing_joints",
      }],
    }, {
      scanModels: async () => [],
      writeNoTrigger: async () => undefined,
      writeTrigger: async (row, trigger) => { triggers.push(`${row.filePath}:${trigger}`) },
      copyFile: async (source, target) => { copied.push(`${source}->${target}`) },
      fileExists: async () => false,
      joinPath: (...parts) => parts.join("/"),
      basename: (path) => path.split("/").at(-1) ?? path,
      extname: (path) => path.slice(path.lastIndexOf(".")),
    })

    expect(result.success).toBe(true)
    expect(copied).toEqual([
      "D:/Downloads/neon_mecha_v2.safetensors->D:/ComfyUI/models/loras/style/mecha/neon_mecha_v2.safetensors",
      "D:/Downloads/neon_mecha.png->D:/ComfyUI/models/loras/style/mecha/neon_mecha_v2.preview.png",
    ])
    expect(triggers).toEqual(["D:/ComfyUI/models/loras/style/mecha/neon_mecha_v2.safetensors:neon_mecha, glowing_joints"])
    expect(result.data?.collection[0]?.status).toBe("collected")
  })

  test("suggests a relative library path from the source path", () => {
    expect(suggestCollectionRelativeDir("D:/Downloads/style/neon_mecha.safetensors")).toBe("style")
    expect(suggestCollectionRelativeDir("D:/Downloads/neon_mecha.safetensors")).toBe("uncategorized/neon-mecha")
  })
})
