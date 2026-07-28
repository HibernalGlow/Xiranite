import { describe, expect, test } from "vitest"
import { extractSameaArtistKeywords, isClassfBlacklistedArtist, mergeClassfBlacklistKeywords, parseSameaArtistLabel, splitSameaArtistAndCircleKeywords, stripOuterKeywordBrackets } from "./blacklist.js"

describe("ClassF blacklist label helpers", () => {
  test("uses SameA parsing to split a circle-qualified artist label", () => {
    expect(parseSameaArtistLabel("[きゅうりのふかづめ (しぐれに)]")).toEqual({
      label: "[きゅうりのふかづめ (しぐれに)]",
      circle: "きゅうりのふかづめ",
      artist: "しぐれに",
    })
    expect(splitSameaArtistAndCircleKeywords(["[きゅうりのふかづめ (しぐれに)]", "[OgoG]"])).toEqual([
      "[きゅうりのふかづめ]",
      "[しぐれに]",
      "[OgoG]",
    ])
    expect(isClassfBlacklistedArtist("[きゅうりのふかづめ (しぐれに)]", ["[しぐれに]"])).toBe(true)
    expect(isClassfBlacklistedArtist("[きゅうりのふかづめ (しぐれに)]", ["[きゅうりのふかづめ]"])).toBe(true)
  })

  test("strips only enclosing brackets without losing inner artist data", () => {
    expect(stripOuterKeywordBrackets("[きゅうりのふかづめ (しぐれに)]")).toBe("きゅうりのふかづめ (しぐれに)")
    expect(stripOuterKeywordBrackets("((OgoG))")).toBe("OgoG")
  })

  test("extracts SameA labels from source names before merging configured entries", () => {
    expect(extractSameaArtistKeywords(["[Circle (Artist)] book.cbz", "plain name"])).toEqual(["[Circle (Artist)]", "[plain name]"])
    expect(mergeClassfBlacklistKeywords(["[OgoG]"], ["[Artist]", "[OgoG]"])).toEqual(["[OgoG]", "[Artist]"])
  })
})
