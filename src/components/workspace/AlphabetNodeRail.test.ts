import { describe, expect, test } from "vitest"
import { getModulesForInitial } from "./AlphabetNodeRail"

describe("getModulesForInitial", () => {
  test("returns registered nodes by display-name initial", () => {
    expect(getModulesForInitial("a").map((module) => module.id)).toContain("audiov")
    expect(getModulesForInitial("S").map((module) => module.id)).toContain("soundw")
  })

  test("does not treat an internal letter as an initial", () => {
    expect(getModulesForInitial("Z")).toEqual([])
  })
})
