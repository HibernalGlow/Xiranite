import { describe, expect, test } from "vitest"
import { enabledXlchemyInputExtensions, isXlchemyInputPathEnabled } from "./input-format-policy"

describe("XLchemy input format policy", () => {
  test("always accepts GIF plus the enabled dynar animation probes", () => {
    const enabled = enabledXlchemyInputExtensions({ format: "dynar", excludedFormatsText: "webp,jxl,avif", detectAnimatedWebp: true })

    expect(enabled).toEqual([".gif", ".webp"])
    expect(isXlchemyInputPathEnabled("D:/images/loop.gif", enabled)).toBe(true)
    expect(isXlchemyInputPathEnabled("D:/images/motion.webp", enabled)).toBe(true)
    expect(isXlchemyInputPathEnabled("D:/images/still.png", enabled)).toBe(false)
  })

  test("maps every optional dynar detector to its source extension", () => {
    expect(enabledXlchemyInputExtensions({ format: "dynar", detectAnimatedPng: true, detectAnimatedWebp: false, detectAnimatedAvif: true, detectAnimatedJxl: true })).toEqual([".gif", ".png", ".apng", ".avif", ".jxl"])
  })

  test("keeps conversion input exclusions unchanged", () => {
    const enabled = enabledXlchemyInputExtensions({ format: "AVIF", excludedFormatsText: "webp, gif" })

    expect(enabled).toContain(".png")
    expect(enabled).not.toContain(".webp")
    expect(enabled).not.toContain(".gif")
  })
})
