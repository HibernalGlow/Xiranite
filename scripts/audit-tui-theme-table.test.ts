import { expect, test } from "bun:test"

import {
  describeThemeDrift,
  namesInRustTable,
  parseHexColour,
  readThemeTable,
  renderRustTable,
  type ThemeEntry,
} from "./audit-tui-theme-table.ts"

const entry = (name: string, primary: [number, number, number, number]): ThemeEntry => ({
  name,
  tokens: {
    primary,
    foreground: [1, 2, 3, 255],
    mutedForeground: [4, 5, 6, 255],
    border: [7, 8, 9, 255],
    focusRing: [10, 11, 12, 255],
    success: [13, 14, 15, 255],
    warning: [16, 17, 18, 255],
    error: [19, 20, 21, 255],
  },
})

test("a colour is read as sRGB with alpha, and alpha defaults to opaque", () => {
  expect(parseHexColour("#88C0D0", "nord", "primary")).toEqual([136, 192, 208, 255])
  expect(parseHexColour("e4e4e45e", "cursor", "border")).toEqual([228, 228, 228, 94])
  // A 3-digit shorthand would silently mean a different colour when expanded wrongly, and a name is not a colour.
  expect(() => parseHexColour("#fff", "x", "primary")).toThrow(/is not a #rrggbb or #rrggbbaa colour/)
  expect(() => parseHexColour("red", "x", "primary")).toThrow(/is not a #rrggbb or #rrggbbaa colour/)
})

test("the rendered table round-trips through the drift reporter", () => {
  const rendered = renderRustTable([entry("nord", [136, 192, 208, 255]), entry("orng", [236, 91, 43, 255])])
  expect(namesInRustTable(rendered)).toEqual(["nord", "orng"])
  expect(describeThemeDrift(rendered, rendered)).toEqual([])

  const recoloured = rendered.replace("primary: (136, 192, 208, 255)", "primary: (136, 192, 209, 255)")
  const colourLines = describeThemeDrift(rendered, recoloured)
  expect(colourLines.length).toBe(1)
  expect(colourLines[0]).toContain("palette changed for nord")
  // A changed colour must be reported as a colour, not as the empty "nothing added, nothing removed".
  expect(colourLines[0]).not.toContain("themes added")

  const dropped = rendered.replace(/^ {8}"orng" => .*\n/m, "")
  const added = describeThemeDrift(dropped, rendered)
  expect(added.some((line) => line.startsWith("themes added by the producer: orng"))).toBe(true)
  const removed = describeThemeDrift(rendered, dropped)
  expect(removed.some((line) => line.startsWith("themes gone from the producer: orng"))).toBe(true)
})

test("the producer itself still publishes the themes the Rust table is generated from", async () => {
  const entries = await readThemeTable()
  expect(entries.length).toBeGreaterThanOrEqual(40)
  const names = entries.map((entry) => entry.name)
  expect(names).toContain("nord")
  expect(names).toContain("default")
  expect(names).toContain("high-contrast")

  const nord = entries.find((candidate) => candidate.name === "nord")!
  expect(nord.tokens.primary).toEqual([136, 192, 208, 255])
  // The translucent entry the port must not flatten without saying so.
  const cursor = entries.find((candidate) => candidate.name === "cursor")!
  expect(cursor.tokens.mutedForeground[3]).toBeLessThan(255)
  // focusRing is derived from primary when a palette omits it; every published theme still ends up with one.
  for (const candidate of entries) expect(candidate.tokens.focusRing.length).toBe(4)
})
