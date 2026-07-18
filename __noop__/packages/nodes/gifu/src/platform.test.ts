import { describe, expect, test } from "vitest"
import { parse7zImageEntries } from "./platform.js"

describe("gifu platform helpers", () => {
  test("keeps 7-Zip archive order while filtering supported image entries", () => {
    const output = `Path = pages/002.png
Size = 12
Folder = -

Path = notes/readme.txt
Size = 4
Folder = -

Path = pages
Folder = +
Attributes = D

Path = pages/001.JXL
Size = 20
Folder = -
`
    expect(parse7zImageEntries(output)).toEqual([
      { path: "pages/002.png", extension: ".png", size: 12 },
      { path: "pages/001.JXL", extension: ".jxl", size: 20 },
    ])
  })
})
