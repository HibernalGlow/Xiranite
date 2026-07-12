import { describe, expect, test } from "vitest"
import { compressionRatio, normalizeXlchemyInput } from "./core.js"

describe("xlchemy core contract", () => {
  test("normalizes paths and clamps encoder controls", () => {
    expect(normalizeXlchemyInput({
      paths: [" D:/images/a.png ", "D:/images/a.png", ""],
      quality: 120,
      effort: 0,
      threads: 200,
    })).toMatchObject({
      paths: ["D:/images/a.png"],
      quality: 100,
      effort: 1,
      threads: 64,
      format: "JPEG XL",
      outputMode: "source",
    })
  })

  test("reports saved storage as a bounded percentage", () => {
    expect(compressionRatio({ inputBytes: 1_000, outputBytes: 425 })).toBe(57.5)
    expect(compressionRatio({ inputBytes: 0, outputBytes: 0 })).toBe(0)
    expect(compressionRatio({ inputBytes: 100, outputBytes: 200 })).toBe(0)
  })
})
