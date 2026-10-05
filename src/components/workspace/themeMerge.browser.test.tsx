import { afterEach, describe, expect, test } from "vitest"
import { useWorkspaceStore } from "@/store/workspaceStore"
import { WorkspaceAppearance } from "./WorkspaceAppearance"
import { DEFAULT_DESIGN_THEME, BRIDGED_COLOR_VARS } from "@/lib/design-theme/contract"

/**
 * 「在使用高级主题的情况下，使用 shadcn 的配色主题 = 直接映射」这条口径的 DOM 级尺。
 *
 * 为什么要在浏览器里跑而不是单测里比对象：两边写的都是同一个 `:root` inline 属性，
 * 「谁盖住谁」是**顺序**问题不是数据问题——只有真 DOM 能证「主题的值活下来了」，
 * 也只有真 DOM 能抓到「高级主题读到上一轮自己写的输出」这类假映射（见 apply.ts 的解析时机）。
 */
const THEME_NAME = "merge-probe"
const THEME_PRIMARY = "oklch(0.62 0.19 259)"
const THEME_CARD = "color-mix(in oklab, #ff00aa 24%, white)"

function mountWithThemeAndMd3() {
  const actions = useWorkspaceStore.getState()
  actions.setCustomThemes([{
    name: THEME_NAME,
    cssVars: { light: { primary: THEME_PRIMARY, card: THEME_CARD } },
  }])
  actions.setThemeSelection("light", { kind: "custom", name: THEME_NAME })
  actions.setDesignTheme({ ...DEFAULT_DESIGN_THEME, id: "md3", md3: { ...DEFAULT_DESIGN_THEME.md3, seedSource: "manual" } })
  const view = render(<WorkspaceAppearance />)
  return view
}

import { render } from "vitest-browser-react"

afterEach(() => {
  const actions = useWorkspaceStore.getState()
  actions.setCustomThemes([])
  actions.setThemeSelection("light", { kind: "preset", name: "wuling" })
  actions.setDesignTheme({ ...DEFAULT_DESIGN_THEME })
  document.documentElement.removeAttribute("style")
})

describe("the shadcn colour theme maps straight into the advanced theme", () => {
  test("theme-provided slots survive verbatim while the rest is derived", async () => {
    mountWithThemeAndMd3()
    await new Promise((resolve) => { setTimeout(resolve, 80) })
    const root = document.documentElement
    const style = getComputedStyle(root)

    expect(style.getPropertyValue("--primary").trim(), "配色主题的主色被高级主题盖掉了").toBe(THEME_PRIMARY)
    expect(style.getPropertyValue("--card").trim()).toBe(THEME_CARD)
    // 主题没声明的槽必须由 seed 派生补上，不能留空（留空就是「看得见地坏掉」）。
    expect(style.getPropertyValue("--muted-foreground").trim()).not.toBe("")
    expect(root.style.getPropertyValue("--muted-foreground")).toMatch(/^#[0-9a-f]{6}$/i)

    // 回读路径：映射了几条要能在 DOM 上问出来，而且是 2 条不是 0 条也不是 36 条。
    expect(root.getAttribute("data-md3-bridge-theme")).toBe(`2/${BRIDGED_COLOR_VARS.length}`)
  })

  test("re-applying does not mistake the previous pass for the colour theme", async () => {
    mountWithThemeAndMd3()
    await new Promise((resolve) => { setTimeout(resolve, 80) })
    const root = document.documentElement
    const first = root.getAttribute("data-md3-bridge-theme")
    expect(first).toBe(`2/${BRIDGED_COLOR_VARS.length}`)

    // 关一次颜色维度再开回来：上一轮自己写的 36 条桥接变量必须先被撤干净再解析，
    // 否则第二次会把「MD3 派生值」当成「主题给的」，计数会莫名涨起来。
    useWorkspaceStore.getState().setDesignTheme({
      ...DEFAULT_DESIGN_THEME, id: "md3",
      dimensions: { ...DEFAULT_DESIGN_THEME.dimensions, color: false },
      md3: { ...DEFAULT_DESIGN_THEME.md3, seedSource: "manual" },
    })
    await new Promise((resolve) => { setTimeout(resolve, 40) })
    expect(root.style.getPropertyValue("--primary"), "关掉颜色维度后还在覆盖主题主色").toBe(THEME_PRIMARY)

    useWorkspaceStore.getState().setDesignTheme({
      ...DEFAULT_DESIGN_THEME, id: "md3",
      md3: { ...DEFAULT_DESIGN_THEME.md3, seedSource: "manual" },
    })
    await new Promise((resolve) => { setTimeout(resolve, 80) })
    expect(root.getAttribute("data-md3-bridge-theme"), "把上一轮自己的输出误读成主题值了").toBe(first)
    expect(getComputedStyle(root).getPropertyValue("--primary").trim()).toBe(THEME_PRIMARY)
  })
})
