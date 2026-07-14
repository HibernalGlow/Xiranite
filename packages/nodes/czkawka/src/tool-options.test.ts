import { describe, expect, test } from "vitest"

import { CZKAWKA_TOOLS } from "./core.js"
import { help } from "./help.js"
import { createCzkawkaInteractionSchema } from "./interaction.js"
import { createCzkawkaOperationInput, createCzkawkaOptionHelpFields, createCzkawkaScanInput, CZKAWKA_CLI_VALUE_FLAGS, CZKAWKA_TOOL_OPTIONS, getCzkawkaToolOptions, parseCzkawkaCliOptions } from "./tool-options.js"

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

  test("generates CLI help and TUI fields from the exact GUI option definitions", () => {
    const interactionIds = new Set(createCzkawkaInteractionSchema().fields.map((field) => field.id))
    const helpFields = createCzkawkaOptionHelpFields("en")
    expect(help.fields).toEqual(helpFields)
    expect(helpFields).toHaveLength(CZKAWKA_TOOL_OPTIONS.length)
    for (const [index, definition] of CZKAWKA_TOOL_OPTIONS.entries()) {
      expect(interactionIds.has(definition.id)).toBe(true)
      expect(helpFields[index]).toMatchObject({ type: definition.kind, defaultValue: String(definition.defaultValue) })
      expect(helpFields[index]?.name).toContain(definition.cliFlag)
      expect(helpFields[index]?.description).toContain(definition.label.en)
      expect(help.translations?.zh?.fields?.[index]?.description).toContain(definition.label.zh)
    }
  })

  test("round-trips every tool-specific CLI flag through the shared parser", () => {
    const args: string[] = []
    const expected: Record<string, unknown> = {}
    for (const definition of CZKAWKA_TOOL_OPTIONS) {
      if (definition.kind === "boolean") {
        args.push(`--no-${definition.cliFlag.slice(2)}`)
        expected[definition.id] = false
      } else {
        const value = definition.choices?.at(-1)?.value ?? String(definition.max ?? definition.defaultValue)
        args.push(definition.cliFlag, value)
        expected[definition.id] = typeof definition.defaultValue === "number" ? Number(value) : value
      }
    }
    expect(parseCzkawkaCliOptions(args)).toEqual(expected)
  })

  test("builds the same core scan contract for every surface", () => {
    expect(createCzkawkaScanInput("similar-images", {
      includedDirectoriesText: "D:/Images\nE:/Archive\nF:/Reference",
      includedDirectoriesReferencedText: "F:/Reference",
      excludedItemsText: "*/cache/*; *.part",
      minimumFileSize: "100",
      similarImagesHashSize: "64",
    })).toMatchObject({
      action: "scan",
      tool: "similar-images",
      includedDirectories: ["D:/Images", "E:/Archive", "F:/Reference"],
      includedDirectoriesReferenced: ["F:/Reference"],
      excludedItems: ["*/cache/*", "*.part"],
      minimumFileSize: 100,
      similarImagesHashSize: 64,
    })
  })

  test("preserves fork list syntax for paths, rules, references, and extension tokens", () => {
    expect(createCzkawkaScanInput("duplicate-files", {
      includedDirectoriesText: '\u2068"D:/Photos"\u2069;E:/Archive,D:/Photos',
      includedDirectoriesReferencedText: "E:/Archive;Z:/missing",
      excludedDirectoriesText: '"D:/Photos/cache",E:/Archive/tmp',
      excludedItemsText: "*/cache/*,*.part;DEFAULT",
      allowedExtensions: ".jpg;png\nIMAGE,jpg",
      excludedExtensions: ".tmp;bak",
    })).toMatchObject({
      includedDirectories: ["D:/Photos", "E:/Archive"],
      includedDirectoriesReferenced: ["E:/Archive"],
      excludedDirectories: ["D:/Photos/cache", "E:/Archive/tmp"],
      excludedItems: ["*/cache/*", "*.part", "DEFAULT"],
      allowedExtensions: "jpg,png,IMAGE",
      excludedExtensions: "tmp,bak",
    })
  })

  test("builds one operation contract for GUI, CLI, and TUI", () => {
    expect(createCzkawkaOperationInput("move", {
      tool: "similar-images",
      selectedPathsText: "D:/one/a.jpg\nD:/two/b.jpg",
      destinationDirectory: "E:/Review",
      destinationItems: [],
      renameItems: [],
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
      renameItems: [],
      deleteMode: "trash",
      copyMode: true,
      preserveStructure: true,
      conflictPolicy: "rename",
      outputPath: undefined,
      outputFormat: "json",
      exportScope: "selected",
      exportEntries: [],
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

  test("parses TUI rename rows and makes export an immediate non-destructive write", () => {
    expect(createCzkawkaOperationInput("rename", { renameItemsText: "D:/photo.bin\t.jpg\nD:/audio.raw\tflac" })).toMatchObject({ action: "rename", renameItems: [{ path: "D:/photo.bin", properExtension: ".jpg" }, { path: "D:/audio.raw", properExtension: "flac" }], dryRun: true })
    expect(createCzkawkaOperationInput("save", { selectedPaths: ["D:/photo.bin"], outputPath: "D:/result.csv", exportScope: "all", dryRun: true })).toMatchObject({ action: "save", outputFormat: "csv", exportScope: "all", dryRun: false })
  })
})
