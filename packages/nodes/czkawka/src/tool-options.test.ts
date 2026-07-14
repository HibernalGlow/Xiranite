import { describe, expect, test } from "vitest"

import { CZKAWKA_TOOLS } from "./core.js"
import { createCzkawkaInteractionSchema } from "./interaction.js"
import { createCzkawkaOperationInput, createCzkawkaScanInput, CZKAWKA_CLI_VALUE_FLAGS, CZKAWKA_TOOL_OPTIONS, getCzkawkaToolOptions, parseCzkawkaCliOptions } from "./tool-options.js"

describe("shared Czkawka option schema", () => {
  test("is the source for every GUI/CLI/TUI tool option", () => {
    const interactionIds = new Set(createCzkawkaInteractionSchema().fields.map((field) => field.id))
    expect(CZKAWKA_TOOL_OPTIONS.every((option) => interactionIds.has(option.id))).toBe(true)
    expect(CZKAWKA_TOOL_OPTIONS.filter((option) => option.kind !== "boolean").every((option) => CZKAWKA_CLI_VALUE_FLAGS.has(option.cliFlag))).toBe(true)
    expect(CZKAWKA_TOOLS.every((tool) => getCzkawkaToolOptions(tool).length > 0 || ["empty-folders", "empty-files", "temporary-files", "invalid-symlinks", "bad-extensions"].includes(tool))).toBe(true)
  })

  test("parses advanced pipe CLI flags from the same definitions", () => {
    expect(parseCzkawkaCliOptions(["--image-hash", "double-gradient", "--image-hash-size", "64", "--image-ignore-same-size", "--no-prehash"])).toMatchObject({
      similarImagesHashAlgorithm: "double-gradient",
      similarImagesHashSize: 64,
      similarImagesIgnoreSameSize: true,
      usePrehash: false,
    })
  })

  test("builds the same core scan contract for every surface", () => {
    expect(createCzkawkaScanInput("similar-images", {
      includedDirectoriesText: "D:/Images\nE:/Archive",
      includedDirectoriesReferencedText: "F:/Reference",
      excludedItemsText: "*/cache/*; *.part",
      minimumFileSize: "100",
      similarImagesHashSize: "64",
    })).toMatchObject({
      action: "scan",
      tool: "similar-images",
      includedDirectories: ["D:/Images", "E:/Archive"],
      includedDirectoriesReferenced: ["F:/Reference"],
      excludedItems: ["*/cache/*", "*.part"],
      minimumFileSize: 100,
      similarImagesHashSize: 64,
    })
  })

  test("builds one operation contract for GUI, CLI, and TUI", () => {
    expect(createCzkawkaOperationInput("move", {
      tool: "similar-images",
      selectedPathsText: "D:/one/a.jpg\nD:/two/b.jpg",
      destinationDirectory: "E:/Review",
      destinationItems: [],
      copyMode: true,
      preserveStructure: true,
      conflictPolicy: "rename",
      dryRun: false,
    })).toEqual({
      action: "move",
      tool: "similar-images",
      selectedPaths: ["D:/one/a.jpg", "D:/two/b.jpg"],
      destinationDirectory: "E:/Review",
      destinationItems: [],
      deleteMode: "trash",
      copyMode: true,
      preserveStructure: true,
      conflictPolicy: "rename",
      outputPath: undefined,
      outputFormat: "json",
      dryRun: false,
    })
  })

  test("exposes safe operations through the shared guided and TUI schema", () => {
    const schema = createCzkawkaInteractionSchema({}, "zh")
    const values = { ...schema.initialValues, action: "delete", selectedPathsText: "D:/old.tmp", deleteMode: "trash", dryRun: true }
    const input = schema.toInput(values)
    expect(input).toMatchObject({ action: "delete", selectedPaths: ["D:/old.tmp"], deleteMode: "trash", dryRun: true })
    expect(schema.validate(values, input)).toBeNull()
    expect(schema.isDangerous?.(input)).toBe(false)
    expect(schema.isDangerous?.({ ...input, dryRun: false })).toBe(true)
  })
})
