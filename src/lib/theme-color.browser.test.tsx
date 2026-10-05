import { afterEach, describe, expect, test } from "vitest"

import { resetThemeColourCache, themeColourHex } from "@/lib/theme-color"

const HEX = /^#[0-9a-f]{6}$/

/**
 * 独立预言机：不经受 token 这条路，直接把同一个 CSS 颜色送进 canvas 读回字节。
 * 有了它，「helper 其实没解析 var」这种失败才会红，而不是和期望值一起塌成 #000000。
 */
function oracle(cssColor: string): string {
  const canvas = document.createElement("canvas")
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new Error("no 2d context")
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = cssColor
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map(n => n.toString(16).padStart(2, "0")).join("")}`
}

afterEach(() => {
  document.documentElement.style.removeProperty("--probe-token")
  resetThemeColourCache()
})

describe("themeColourHex", () => {
  test("the oracle can see a difference (positive control)", () => {
    expect(oracle("#123456")).toBe("#123456")
    expect(oracle("oklch(0.628 0.258 29.234)")).toMatch(HEX)
    expect(oracle("oklch(0.628 0.258 29.234)")).not.toBe("#000000")
  })

  test("a declared token resolves to exactly the bytes the browser gives the raw colour", () => {
    const source = "oklch(0.628 0.258 29.234)"
    document.documentElement.style.setProperty("--probe-token", source)
    resetThemeColourCache()

    expect(themeColourHex("--probe-token")).toBe(oracle(source))
  })

  test("an undeclared token returns the fallback instead of an inherited black", () => {
    expect(themeColourHex("--probe-token", "#ff00aa")).toBe("#ff00aa")
  })

  test("the cache is dropped when the host writes a new token value", async () => {
    document.documentElement.style.setProperty("--probe-token", "#123456")
    resetThemeColourCache()
    expect(themeColourHex("--probe-token")).toBe("#123456")

    // 第二次改动不手动清缓存：靠 <html> 上的 MutationObserver 自己失效。
    document.documentElement.style.setProperty("--probe-token", "#abcdef")
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(themeColourHex("--probe-token")).toBe("#abcdef")
  })
})
