import { describe, expect, test } from "vitest"

import { assertCzkawkaCompatibility, checkCzkawkaCompatibility } from "./compatibility.js"

describe("Czkawka Node-API compatibility", () => {
  test("accepts a newer upstream source when API and capabilities match", () => {
    expect(
      checkCzkawkaCompatibility(
        { apiVersion: 5, sourceVersion: "12.0.0", capabilities: ["scan.progress.v2", "scan.cancel"] },
        { minimumApiVersion: 5, requiredCapabilities: ["scan.progress.v2", "scan.cancel"] },
      ),
    ).toEqual({ compatible: true, missingCapabilities: [] })
  })

  test("rejects only a too-old Xiranite transport version", () => {
    const result = checkCzkawkaCompatibility(
      { apiVersion: 4, sourceVersion: "99.0.0", capabilities: ["scan.progress.v2"] },
      { minimumApiVersion: 5 },
    )
    expect(result).toMatchObject({ compatible: false, missingCapabilities: [] })
    expect(() => assertCzkawkaCompatibility({ apiVersion: 4, sourceVersion: "99.0.0", capabilities: [] }, { minimumApiVersion: 5 })).toThrow(/older/i)
  })

  test("reports every missing required capability without treating source version as a gate", () => {
    const result = checkCzkawkaCompatibility(
      { apiVersion: 5, sourceVersion: "10.0.0", capabilities: ["scan.progress.v2"] },
      { minimumApiVersion: 5, requiredCapabilities: ["scan.cancel", "scan.progress.v2", "scan.cancel"] },
    )
    expect(result).toMatchObject({ compatible: false, missingCapabilities: ["scan.cancel"] })
  })
})
