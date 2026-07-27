import { describe, expect, test } from "vitest"
import { CZKAWKA_TOOL_OPTIONS } from "@xiranite/node-czkawka/tool-options"

import { CZKAWKA_NODE_CONFIG_KEYS, pickCzkawkaNodeConfig } from "./node-config"

describe("Czkawka TOML configuration", () => {
  test("keeps reusable scanner settings and excludes workspace state", () => {
    expect(pickCzkawkaNodeConfig({
      tool: "similar-images",
      includedDirectoriesText: "D:/Photos",
      similarImagesHashAlgorithm: "double-gradient",
      similarImagesResizeAlgorithm: "catmull-rom",
      videoOptimizerTargetCodec: "av1",
      result: { fileCount: 42 },
      activityLog: [{ message: "scan complete" }],
      workspaceLayout: { version: 1 },
    })).toEqual({
      tool: "similar-images",
      includedDirectoriesText: "D:/Photos",
      similarImagesHashAlgorithm: "double-gradient",
      similarImagesResizeAlgorithm: "catmull-rom",
      videoOptimizerTargetCodec: "av1",
    })
  })

  test("ignores a malformed node config payload", () => {
    expect(pickCzkawkaNodeConfig(["similar-images"])).toEqual({})
  })

  test("preserves explicit removals for the TOML writer", () => {
    expect(pickCzkawkaNodeConfig({ activeScanPresetId: undefined })).toEqual({ activeScanPresetId: undefined })
  })

  test("includes every GUI algorithm field in the TOML configuration contract", () => {
    const algorithmSettings = Object.fromEntries(CZKAWKA_TOOL_OPTIONS.map((option) => [option.id, "configured"]))

    expect(CZKAWKA_NODE_CONFIG_KEYS).toEqual(expect.arrayContaining(CZKAWKA_TOOL_OPTIONS.map((option) => option.id)))
    expect(pickCzkawkaNodeConfig(algorithmSettings)).toEqual(algorithmSettings)
  })
})
