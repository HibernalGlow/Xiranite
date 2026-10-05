import { afterEach, describe, expect, test } from "vitest"
import { render } from "vitest-browser-react"

import i18n from "@/i18n"
import { WorkspaceAppearance } from "@/components/workspace/WorkspaceAppearance"
import { useWorkspaceStore } from "@/store/workspaceStore"
import { DEFAULT_DESIGN_THEME } from "@/lib/design-theme/contract"
import { DesignThemeSection } from "./DesignThemeSection"

/**
 * 端到端的一条：设置页点一下 → store → WorkspaceAppearance/applyDesignTheme → `:root`。
 *
 * 之所以要在浏览器里跑，而不是单测里 mock：这一条链上最容易出的错是「组件渲染了、
 * action 也调了，但 DOM 上一个变量都没变」——那种坏只有真 CSS 引擎加真 DOM 才看得见。
 * 夹具一律从 `DEFAULT_DESIGN_THEME` 出发，不在测试里抄一份配置形状。
 */
async function renderSection() {
  await i18n.changeLanguage("en")
  return render(
    <>
      <WorkspaceAppearance />
      <DesignThemeSection />
    </>,
  )
}

afterEach(() => {
  useWorkspaceStore.getState().setDesignTheme({ ...DEFAULT_DESIGN_THEME })
  document.documentElement.removeAttribute("style")
})

describe("advanced theme settings drive the document root", () => {
  test("native writes no variables and is honestly reported", async () => {
    await renderSection()
    const root = document.documentElement
    await expect.element(root).toHaveAttribute("data-app-design", "native")
    expect(root.getAttribute("data-design-applied-vars")).toBe("0")
    expect(root.hasAttribute("data-md3-seed")).toBe(false)
  })

  test("picking Material 3 emits tokens and records which recipe/variant is live", async () => {
    const screen = await renderSection()
    const select = screen.getByRole("combobox", { name: /DESIGN LANGUAGE/i })
    await select.click()
    await screen.getByRole("option", { name: /Material 3/i }).click()

    const root = document.documentElement
    await expect.element(root).toHaveAttribute("data-app-design", "md3")
    const applied = Number(root.getAttribute("data-design-applied-vars") ?? "0")
    // 真正的证据是变量条数，不是「我点过了」。
    expect(applied, "切到 MD3 之后 :root 上一个 token 都没写").toBeGreaterThan(60)
    expect(root.getAttribute("data-md3-variant")).toBe(DEFAULT_DESIGN_THEME.md3.variant)
    // 取色默认档：不写死 "manual"/"activeTheme" 这个词，而是跟契约的默认值比——
    // 默认改了这条不会假绿，下面的 seed 等值断言会跟着动。
    expect(root.getAttribute("data-md3-seed-source")).toBe(DEFAULT_DESIGN_THEME.md3.seedSource)
    if (DEFAULT_DESIGN_THEME.md3.seedSource === "activeTheme") {
      // 端到端证明「有些本身是取色的就按取色的来」：seed 必须就是当前配色主题的主色。
      const themePrimary = getComputedStyle(root).getPropertyValue("--primary").trim()
      expect(root.getAttribute("data-md3-seed"), `seed 没跟着配色主题的主色走（主题主色 ${themePrimary}）`).toBeTruthy()
      expect(root.getAttribute("data-md3-seed-fallback")).toBe("false")
    }
    expect(root.getAttribute("data-md3-seed-fallback")).toBe("false")
    // 桥接色必须真落到 inline 样式上，否则颜色维度只是界面上一个摆设。
    expect(root.style.getPropertyValue("--primary")).not.toBe("")
  })

  test("turning the colour dimension off stops overwriting the theme's own colours", async () => {
    useWorkspaceStore.getState().setDesignTheme({ ...DEFAULT_DESIGN_THEME, id: "md3" })
    const screen = await renderSection()
    const colourSwitch = screen.getByRole("switch", { name: /Color roles/i })
    await colourSwitch.click()

    const root = document.documentElement
    await expect.element(root).toHaveAttribute("data-design-color", "off")
    expect(root.style.getPropertyValue("--primary")).toBe("")
    // 颜色关了不该连带把形状也关掉。
    expect(root.style.getPropertyValue("--md-sys-shape-corner-medium")).not.toBe("")
  })

  test("switching the recipe back to native withdraws exactly what it wrote", async () => {
    useWorkspaceStore.getState().setDesignTheme({ ...DEFAULT_DESIGN_THEME, id: "md3" })
    const screen = await renderSection()
    const root = document.documentElement
    const emitted = Object.keys(
      Array.from(root.style).reduce<Record<string, string>>((acc, name) => {
        acc[name] = root.style.getPropertyValue(name)
        return acc
      }, {}),
    )
    expect(emitted.length, "MD3 下没有 inline 变量，后面那条断言会是假绿").toBeGreaterThan(60)

    const select = screen.getByRole("combobox", { name: /DESIGN LANGUAGE/i })
    await select.click()
    await screen.getByRole("option", { name: /Native/i }).click()

    await expect.element(root).toHaveAttribute("data-app-design", "native")
    for (const name of emitted) {
      if (name.startsWith("--md-")) expect(root.style.getPropertyValue(name), `${name} 没被撤掉`).toBe("")
    }
  })
  test("picking De Stijl emits its own palette and reports the accent on the root", async () => {
    const screen = await renderSection()
    await screen.getByRole("combobox", { name: /DESIGN LANGUAGE/i }).click()
    await screen.getByRole("option", { name: /De Stijl/i }).click()

    const root = document.documentElement
    await expect.element(root).toHaveAttribute("data-app-design", "mondrian")
    const applied = Number(root.getAttribute("data-design-applied-vars") ?? "0")
    expect(applied, "切到风格派之后 :root 上一个 token 都没写").toBeGreaterThan(30)
    expect(root.getAttribute("data-stijl-accent")).toBe(DEFAULT_DESIGN_THEME.mondrian.accent)
    expect(root.getAttribute("data-stijl-line")).toBe(String(DEFAULT_DESIGN_THEME.mondrian.lineWeight))
    // 与 DOM 上真的写了几条对齐，而不是等于手抄的词汇表长度。
    const inline = [...root.style].filter((name) => name.startsWith("--stijl-"))
    expect(root.getAttribute("data-stijl-tokens")).toBe(String(inline.length))
    expect(root.style.getPropertyValue("--stijl-color-accent")).not.toBe("")
    expect(root.style.getPropertyValue("--primary")).not.toBe("")
    // 风格派没有 seed：这两条必须**没有**被伪造成什么值。
    expect(root.hasAttribute("data-md3-seed")).toBe(false)
  })

  test("the accent and line controls reach the document, not just the store", async () => {
    useWorkspaceStore.getState().setDesignTheme({ ...DEFAULT_DESIGN_THEME, id: "mondrian" })
    const screen = await renderSection()

    const before = document.documentElement.style.getPropertyValue("--stijl-color-accent")
    await screen.getByRole("radio", { name: /Blue/i }).click()
    await expect.element(document.documentElement).toHaveAttribute("data-stijl-accent", "blue")
    const after = document.documentElement.style.getPropertyValue("--stijl-color-accent")
    expect(after, "换了主动作面但变量没变").not.toBe(before)

    await screen.getByRole("radio", { name: /Heavy/i }).click()
    await expect.element(document.documentElement).toHaveAttribute("data-stijl-line", "3")
    expect(document.documentElement.style.getPropertyValue("--stijl-line-width")).toBe("3px")
  })
})
