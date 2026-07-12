import { describe, expect, test } from "vitest"
import { createXlchemyInteractionSchema } from "./interaction.js"

describe("xlchemy interaction schema", () => {
  test("maps shared TUI fields to the native core input", () => {
    const schema = createXlchemyInteractionSchema({ pathsText: "D:/images\nD:/more", action: "convert", format: "AVIF", outputMode: "directory", outputDir: "D:/out", existingPolicy: "rename" })
    const input = schema.toInput(schema.initialValues)
    expect(input).toMatchObject({ action: "convert", paths: ["D:/images", "D:/more"], format: "AVIF", outputMode: "directory", outputDir: "D:/out", existingPolicy: "rename" })
    expect(schema.validate(schema.initialValues, input)).toBeNull()
  })

  test("gates destructive overwrite and delete-original conversions", () => {
    const schema = createXlchemyInteractionSchema({ action: "convert", pathsText: "D:/a.png", existingPolicy: "replace" })
    expect(schema.isDangerous?.(schema.toInput(schema.initialValues))).toBe(true)
  })

  test("exposes and maps the complete conversion capability set", () => {
    const schema = createXlchemyInteractionSchema({
      pathsText: "D:/a.png", action: "convert", format: "AVIF", avifEncoder: "slimg", avifBitDepth: "10",
      deleteOriginal: true, deleteOriginalMode: "trash", metadataMode: "exiftool-custom", exiftoolCustomArgs: '-Artist="X" "$dst"',
      downscaleEnabled: true, downscaleMode: "megapixels", downscaleMegapixels: 3.2, downscaleResample: "lanczos",
      ramOptimizer: "dynamic", enableCustomArgs: true, avifencArgs: "--foo bar", processingOrder: "size-desc", excludedFormatsText: "gif,bmp",
    })
    const ids = new Set(schema.fields.map((field) => field.id))
    for (const id of ["maxCompression", "jxlPngFallback", "jxlNormalizeWhen", "smallestPng", "avifEncoder", "deleteOriginalMode", "processingOrder", "exiftoolCustomArgs", "downscaleMegapixels", "ramOptimizerRules", "avifencArgs"]) expect(ids.has(id)).toBe(true)
    const input = schema.toInput(schema.initialValues)
    expect(input).toMatchObject({ avifEncoder: "slimg", avifBitDepth: "10", deleteOriginalMode: "trash", metadataMode: "exiftool-custom", exiftoolCustomArgs: '-Artist="X" "$dst"', processingOrder: "size-desc", excludedFormats: ["gif", "bmp"], ramOptimizer: "dynamic", enableCustomArgs: true, avifencArgs: "--foo bar", downscale: { enabled: true, mode: "megapixels", megapixels: 3.2, resample: "lanczos" } })
    expect(schema.view?.sections.map((section) => section.id)).toEqual(["input", "files", "modify", "advanced"])
  })
})
