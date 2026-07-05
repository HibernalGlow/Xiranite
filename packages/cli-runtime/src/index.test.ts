import { describe, expect, test } from "bun:test"
import { flagBoolean, flagNumber, flagString, parseArgs } from "./index.js"

describe("parseArgs", () => {
  test("parses positionals, booleans, values, and kebab flags", () => {
    const parsed = parseArgs(["filter", "--source-file", "a.txt", "--json", "--limit=10"])

    expect(parsed.positionals).toEqual(["filter"])
    expect(flagString(parsed.flags, "sourceFile")).toBe("a.txt")
    expect(flagBoolean(parsed.flags, "json")).toBe(true)
    expect(flagNumber(parsed.flags, "limit", 0)).toBe(10)
  })
})
