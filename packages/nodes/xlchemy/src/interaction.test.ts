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
})
