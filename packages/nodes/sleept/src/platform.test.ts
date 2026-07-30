import { describe, expect, test } from "vitest"
import { resolvePowerCommand } from "./platform.js"

describe("Sleept platform power commands", () => {
  test("maps Windows hibernate to shutdown /h", () => {
    expect(resolvePowerCommand("win32", "hibernate")).toEqual({
      executable: "shutdown",
      args: ["/h"],
    })
  })

  test("does not silently replace macOS hibernate with sleep", () => {
    expect(resolvePowerCommand("darwin", "hibernate")).toBeUndefined()
  })
})
