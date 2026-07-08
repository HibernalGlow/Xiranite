// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import { applyFontPreset, applyThemePreset, mirrorAestivusThemeStorage } from "./appearance"

afterEach(() => {
  document.documentElement.removeAttribute("class")
  document.documentElement.removeAttribute("data-app-theme")
  document.documentElement.removeAttribute("data-font-preset")
  document.documentElement.removeAttribute("data-custom-font")
  document.documentElement.removeAttribute("style")
  localStorage.clear()
})

describe("appearance bridge", () => {
  test("applies theme preset to the document root for portals and floating surfaces", () => {
    applyThemePreset("endfield")

    expect(document.documentElement.dataset.appTheme).toBe("endfield")
    expect(document.documentElement.classList.contains("theme-endfield")).toBe(true)

    applyThemePreset("spatial")

    expect(document.documentElement.dataset.appTheme).toBe("spatial")
    expect(document.documentElement.classList.contains("theme-endfield")).toBe(false)
    expect(document.documentElement.classList.contains("theme-spatial")).toBe(true)
  })

  test("keeps aestivus-compatible storage and font variables in sync", () => {
    applyFontPreset("aestivus")
    mirrorAestivusThemeStorage("wuling", "dark")

    expect(document.documentElement.getAttribute("data-custom-font")).toBe("enabled")
    expect(document.documentElement.style.getPropertyValue("--font-custom-sans")).toContain("LXGW WenKai")
    expect(localStorage.getItem("theme-name")).toBe("Wuling")
    expect(localStorage.getItem("theme-mode")).toBe("dark")
  })
})
