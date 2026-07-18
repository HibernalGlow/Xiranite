import { describe, expect, test } from "vitest"

import { addCzkawkaPaths, addCzkawkaPathsWithReferences, isValidCzkawkaExcludedItem, isValidCzkawkaExtensionToken, parseCzkawkaExtensionTokens, parseCzkawkaList, reconcileCzkawkaReferences, removeCzkawkaPaths, serializeCzkawkaExtensionTokens, serializeCzkawkaPaths, setAllCzkawkaReferences, toggleCzkawkaReference } from "./source-inputs.js"

describe("Czkawka source input model", () => {
  test("matches the fork list syntax and removes exact duplicates", () => {
    expect(parseCzkawkaList('\u2068"D:/Photos"\u2069, E:/Archive;D:/Photos\nF:/More')).toEqual(["D:/Photos", "E:/Archive", "F:/More"])
    expect(serializeCzkawkaPaths(["D:/Photos", "D:/Photos", "E:/Archive"])).toBe("D:/Photos\nE:/Archive")
  })

  test("adds, removes, and serializes persistent directory lists", () => {
    expect(addCzkawkaPaths("D:/old", '"E:/new";D:/old')).toEqual(["E:/new", "D:/old"])
    expect(removeCzkawkaPaths("D:/one\nD:/two\nD:/three", ["D:/two"])).toEqual(["D:/one", "D:/three"])
  })

  test("keeps references constrained to included directories", () => {
    const included = ["D:/one", "D:/two"]
    expect(reconcileCzkawkaReferences(included, ["D:/two", "D:/missing"])).toEqual(["D:/two"])
    expect(toggleCzkawkaReference(included, ["D:/two"], "D:/one")).toEqual(["D:/one", "D:/two"])
    expect(toggleCzkawkaReference(included, ["D:/two"], "D:/two")).toEqual([])
    expect(setAllCzkawkaReferences(included, true)).toEqual(included)
  })

  test("automatically marks only newly added paths matching reference keywords", () => {
    expect(addCzkawkaPathsWithReferences("D:/photos", [], ["E:/#compare/archive", "F:/normal"], "#compare; reference")).toEqual({
      paths: ["E:/#compare/archive", "F:/normal", "D:/photos"],
      references: ["E:/#compare/archive"],
    })
    expect(addCzkawkaPathsWithReferences("D:/#compare/existing", [], [], "#compare").references).toEqual([])
  })

  test("normalizes extension tokens without changing Czkawka macros", () => {
    expect(parseCzkawkaExtensionTokens(".jpg; png\nIMAGE,jpg")).toEqual(["jpg", "png", "IMAGE"])
    expect(serializeCzkawkaExtensionTokens([".jpg", "png", "IMAGE", "jpg"])).toBe("jpg,png,IMAGE")
    expect(isValidCzkawkaExtensionToken("tar.gz")).toBe(false)
    expect(isValidCzkawkaExtensionToken("jpg")).toBe(true)
    expect(isValidCzkawkaExcludedItem("cache")).toBe(false)
    expect(isValidCzkawkaExcludedItem("*/cache/*")).toBe(true)
    expect(isValidCzkawkaExcludedItem("DEFAULT")).toBe(true)
  })
})
