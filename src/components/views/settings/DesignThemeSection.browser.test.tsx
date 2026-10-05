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
    expect(root.getAttribute("data-md3-seed-source")).toBe("manual")
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
})
